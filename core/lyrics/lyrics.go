package lyrics

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	. "github.com/Masterminds/squirrel"
	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/persistence"
	"github.com/navidrome/navidrome/utils/cache"
)

// maxLegacyLyricsCandidates bounds the duplicate window scanned by the legacy
// artist/title lookup, so source-priority resolution can still reach older
// matches without turning it into an unbounded table scan.
const maxLegacyLyricsCandidates = 10

const (
	lyricsCacheSize    = 1000
	lyricsCacheTTL     = 5 * time.Minute
	lyricsLoadTimeout  = time.Minute
	detailedLoadBudget = 30 * time.Second
)

// Provider fetches lyrics for a single media file. It is the contract
// implemented by individual lyrics sources, such as plugins.
type Provider interface {
	GetLyrics(ctx context.Context, mf *model.MediaFile) (model.LyricList, error)
}

// Lyrics resolves lyrics for media files, honoring the configured source
// priority.
type Lyrics interface {
	Provider
	GetLyricsVariants(ctx context.Context, mf *model.MediaFile, allSources bool) (model.LyricList, error)
	GetLyricsVariantsResult(ctx context.Context, mf *model.MediaFile, allSources bool) (model.LyricsResult, error)
	RefreshLyricsVariantsResult(ctx context.Context, mf *model.MediaFile, allSources bool) (model.LyricsResult, error)
	GetLyricsByArtistTitle(ctx context.Context, artist, title string) (model.LyricList, error)
	ListLyricsVariants(ctx context.Context, mf *model.MediaFile) ([]model.LyricsVariant, error)
	ListLyricsVariantsResult(ctx context.Context, mf *model.MediaFile) ([]model.LyricsVariant, []model.LyricsEvidence, error)
	GetLyricsOriginal(ctx context.Context, mf *model.MediaFile, plugin string, identity model.LyricsVariantIdentity) (model.LyricsOriginal, error)
}

// DetailedProvider is implemented by providers that expose every cached
// playback representation with its addressable identity.
type DetailedProvider interface {
	Provider
	GetLyricsDetailed(ctx context.Context, mf *model.MediaFile) (model.LyricList, error)
}

// DetailedResultProvider exposes typed evidence alongside enhanced playback.
type DetailedResultProvider interface {
	GetLyricsDetailedResult(ctx context.Context, mf *model.MediaFile) (model.LyricsResult, error)
}

// VariantsResultProvider exposes typed evidence alongside the variant listing.
type VariantsResultProvider interface {
	ListLyricsVariantsResult(ctx context.Context, mf *model.MediaFile) ([]model.LyricsVariant, []model.LyricsEvidence, error)
}

// OriginalsProvider is the optional plugin surface for variant listings and
// exact source-native documents. Providers without it keep working.
type OriginalsProvider interface {
	DetailedProvider
	ListLyricsVariants(ctx context.Context, mf *model.MediaFile) ([]model.LyricsVariant, error)
	GetOriginal(ctx context.Context, mf *model.MediaFile, identity model.LyricsVariantIdentity) (model.LyricsOriginal, error)
}

// PublicationProvider is implemented by plugin adapters that can carry live
// host publication metadata into classic, enhanced and original calls.
type PublicationProvider interface {
	PublicationGeneration() string
	StartPublication(ctx context.Context, mf *model.MediaFile, kind string) (model.LyricsPublication, bool, error)
	// GetLyricsWithPublication returns supported=false together with the
	// required v1 result when the optional classic-capable export is absent, so
	// the caller never repeats the lookup.
	GetLyricsWithPublication(ctx context.Context, mf *model.MediaFile, publication model.LyricsPublication) (model.LyricList, model.LyricsDiscovery, bool, error)
	// GetLyricsDetailedResultWithRefresh returns supported=false together with
	// the required v1 fallback result when the optional v2 export is absent.
	GetLyricsDetailedResultWithRefresh(ctx context.Context, mf *model.MediaFile, publication model.LyricsPublication, refresh bool) (model.LyricsResult, bool, error)
	AbortPublication(ctx context.Context, mf *model.MediaFile, publication model.LyricsPublication) error
	GetOriginalWithPublication(ctx context.Context, mf *model.MediaFile, identity model.LyricsVariantIdentity, publication model.LyricsPublication) (model.LyricsOriginal, bool, error)
}

// PluginLoader discovers and loads lyrics provider plugins.
type PluginLoader interface {
	LoadLyricsProvider(name string) (Provider, bool)
}

type lyricsService struct {
	ds           model.DataStore
	pluginLoader PluginLoader
	pluginCache  cache.SimpleCache[pluginKey, model.LyricList]
	pluginOnce   sync.Once
	detailed     *detailedCoordinator
}

// pluginCacheFor lazily starts the legacy cache. Detailed-only callers should not
// pay for the cache's background goroutine.
func (l *lyricsService) pluginCacheFor() cache.SimpleCache[pluginKey, model.LyricList] {
	l.pluginOnce.Do(func() {
		l.pluginCache = cache.NewSimpleCache[pluginKey, model.LyricList](cache.Options{
			SizeLimit:  lyricsCacheSize,
			DefaultTTL: lyricsCacheTTL,
		})
	})
	return l.pluginCache
}

type pluginKey struct {
	plugin      string
	mediaFileID string
	trackKey    string
}

// NewLyrics creates a new lyrics service. pluginLoader may be nil if no plugin
// system is available.
func NewLyrics(ds model.DataStore, pluginLoader PluginLoader) Lyrics {
	return &lyricsService{
		ds:           ds,
		pluginLoader: pluginLoader,
		detailed:     newDetailedCoordinator(),
	}
}

// GetLyrics returns lyrics for the given media file, trying sources in the
// order specified by conf.Server().LyricsPriority.
func (l *lyricsService) GetLyrics(ctx context.Context, mf *model.MediaFile) (model.LyricList, error) {
	return l.getLyricsForCandidates(ctx, []*model.MediaFile{mf})
}

// GetLyricsVariants includes every configured local source. The initial lookup
// retains priority short-circuiting for plugins; allSources also queries the
// remaining plugins, for background discovery while clients display lyrics.
// Discovery can return both variants and an error when only some sources succeed.
func (l *lyricsService) GetLyricsVariants(ctx context.Context, mf *model.MediaFile, allSources bool) (model.LyricList, error) {
	result, err := l.GetLyricsVariantsResult(ctx, mf, allSources)
	return result.Lyrics, err
}

func (l *lyricsService) GetLyricsVariantsResult(ctx context.Context, mf *model.MediaFile, allSources bool) (model.LyricsResult, error) {
	return l.getLyricsVariantsResult(ctx, mf, allSources, false)
}

// RefreshLyricsVariantsResult bypasses cached negative plugin state on eligible
// sources while preserving provider cooldowns and freshness.
func (l *lyricsService) RefreshLyricsVariantsResult(ctx context.Context, mf *model.MediaFile, allSources bool) (model.LyricsResult, error) {
	return l.getLyricsVariantsResult(ctx, mf, allSources, true)
}

func (l *lyricsService) getLyricsVariantsResult(ctx context.Context, mf *model.MediaFile, allSources, refresh bool) (model.LyricsResult, error) {
	if err := ctx.Err(); err != nil {
		return model.LyricsResult{}, err
	}
	patterns := []string{}
	seen := map[string]bool{}
	for pattern := range strings.SplitSeq(conf.Server().LyricsPriority, ",") {
		pattern = strings.TrimSpace(pattern)
		if pattern != "" && !seen[pattern] {
			patterns = append(patterns, pattern)
			seen[pattern] = true
		}
	}

	results := make([]sourceResult, len(patterns))
	var discoveryErr error
	if allSources {
		results, discoveryErr = l.discoverSources(ctx, mf, patterns, true, refresh)
	} else {
		found := false
		for i, pattern := range patterns {
			if err := ctx.Err(); err != nil {
				return model.LyricsResult{}, err
			}
			if found && !isLocalSource(pattern) {
				continue
			}
			result, err := l.getLyricsFromSourceResult(ctx, mf, pattern, true, refresh)
			results[i] = sourceResult{lyrics: result.Lyrics, evidence: result.Evidence, discovery: result.Discovery, err: err}
			found = found || (err == nil && len(result.Lyrics) > 0)
		}
	}
	if err := ctx.Err(); err != nil {
		return model.LyricsResult{}, err
	}
	var variants model.LyricList
	var evidence []model.LyricsEvidence
	pluginErr := discoveryErr
	partialErr := discoveryErr
	for i, entry := range results {
		if entry.err != nil {
			partialErr = errors.Join(partialErr, entry.err)
			log.Error(ctx, "error getting lyrics", "source", patterns[i], entry.err)
			if !isLocalSource(patterns[i]) {
				pluginErr = errors.Join(pluginErr, entry.err)
			}
			continue
		}
		variants = append(variants, entry.lyrics...)
		evidence = append(evidence, entry.evidence...)
	}
	result := model.LyricsResult{Lyrics: variants, Evidence: evidence, Discovery: aggregateDiscovery(results)}
	if len(variants) > 0 || len(evidence) > 0 {
		if allSources || partialErr != nil {
			return result, partialErr
		}
		return result, nil
	}
	return model.LyricsResult{Discovery: result.Discovery}, pluginErr
}

// sourceResult retains source priority independently of completion order.
type sourceResult struct {
	index     int
	lyrics    model.LyricList
	evidence  []model.LyricsEvidence
	discovery model.LyricsDiscovery
	err       error
}

func (l *lyricsService) discoverSources(ctx context.Context, mf *model.MediaFile, patterns []string, detailed, refresh bool) ([]sourceResult, error) {
	// Match the plugin host's normal call budget; providers need no special
	// caching or fast-response protocol to participate in source discovery.
	ctx, cancel := context.WithTimeout(ctx, detailedLoadBudget)
	defer cancel()
	results := make([]sourceResult, len(patterns))
	completed := make(chan sourceResult, len(patterns))
	for i, pattern := range patterns {
		go func() {
			result, err := l.getLyricsFromSourceResult(ctx, mf, pattern, detailed, refresh)
			completed <- sourceResult{index: i, lyrics: result.Lyrics, evidence: result.Evidence, discovery: result.Discovery, err: err}
		}()
	}
	for remaining := len(patterns); remaining > 0; remaining-- {
		select {
		case entry := <-completed:
			results[entry.index] = entry
		case <-ctx.Done():
			// Drain completed successes before returning partial results.
			// Buffered sends let late providers exit after cancellation.
			for {
				select {
				case entry := <-completed:
					results[entry.index] = entry
				default:
					return results, ctx.Err()
				}
			}
		}
	}
	return results, nil
}

func isLocalSource(pattern string) bool {
	return strings.EqualFold(pattern, "embedded") || strings.HasPrefix(pattern, ".")
}

func aggregateDiscovery(results []sourceResult) model.LyricsDiscovery {
	revisions := make([]string, 0, len(results))
	complete := true
	found := false
	for _, entry := range results {
		if entry.discovery.Revision == "" {
			continue
		}
		found = true
		revisions = append(revisions, entry.discovery.Revision)
		if !entry.discovery.Complete {
			complete = false
		}
	}
	if !found {
		return model.LyricsDiscovery{}
	}
	sort.Strings(revisions)
	sum := sha256.Sum256([]byte(strings.Join(revisions, "\x00")))
	return model.LyricsDiscovery{Revision: hex.EncodeToString(sum[:16]), Complete: complete}
}

// GetLyricsByArtistTitle resolves lyrics for the legacy artist/title lookup,
// scanning a bounded window of duplicate matches so source priority still wins
// across them.
func (l *lyricsService) GetLyricsByArtistTitle(ctx context.Context, artist, title string) (model.LyricList, error) {
	opts := songsByArtistTitleWithLyricsFirst(artist, title)
	opts.Max = maxLegacyLyricsCandidates
	mediaFiles, err := l.ds.MediaFile().GetAll(ctx, opts)
	if err != nil {
		return nil, err
	}
	if len(mediaFiles) == 0 {
		return nil, nil
	}
	candidates := make([]*model.MediaFile, 0, len(mediaFiles))
	for i := range mediaFiles {
		candidates = append(candidates, &mediaFiles[i])
	}
	return l.getLyricsForCandidates(ctx, candidates)
}

func songsByArtistTitleWithLyricsFirst(artist, title string) model.QueryOptions {
	return model.QueryOptions{
		Sort:  "lyrics, updated_at",
		Order: "desc",
		Filters: And{
			Eq{"missing": false},
			Eq{"title": title},
			Or{
				persistence.Exists("json_tree(participants, '$.albumartist')", Eq{"value": artist}),
				persistence.Exists("json_tree(participants, '$.artist')", Eq{"value": artist}),
			},
		},
	}
}

func (l *lyricsService) getLyricsForCandidates(ctx context.Context, mediaFiles []*model.MediaFile) (model.LyricList, error) {
	var pluginErr error
	for pattern := range strings.SplitSeq(conf.Server().LyricsPriority, ",") {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}

		for _, mf := range mediaFiles {
			if mf == nil {
				continue
			}

			lyricsList, err := l.getLyricsFromSource(ctx, mf, pattern, false)
			if err != nil {
				log.Error(ctx, "error getting lyrics", "source", pattern, err)
				if !strings.EqualFold(pattern, "embedded") && !strings.HasPrefix(pattern, ".") {
					pluginErr = errors.Join(pluginErr, err)
				}
				continue
			}

			if len(lyricsList) > 0 {
				return lyricsList, nil
			}
		}
	}

	return nil, pluginErr
}

func (l *lyricsService) getLyricsFromSource(ctx context.Context, mf *model.MediaFile, pattern string, detailed bool) (model.LyricList, error) {
	result, err := l.getLyricsFromSourceResult(ctx, mf, pattern, detailed, false)
	return result.Lyrics, err
}

func (l *lyricsService) getLyricsFromSourceResult(ctx context.Context, mf *model.MediaFile, pattern string, detailed, refresh bool) (model.LyricsResult, error) {
	switch {
	case strings.EqualFold(pattern, "embedded"):
		list, err := fromEmbedded(ctx, mf)
		return model.LyricsResult{Lyrics: list}, err
	case strings.HasPrefix(pattern, "."):
		list, err := fromExternalFile(ctx, mf, pattern)
		return model.LyricsResult{Lyrics: list}, err
	default:
		return l.fromPluginResult(ctx, mf, pattern, detailed, refresh)
	}
}
