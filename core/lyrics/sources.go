package lyrics

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"path"
	"strings"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/core/storage"
	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/utils/ioutils"
)

func fromEmbedded(ctx context.Context, mf *model.MediaFile) (model.LyricList, error) {
	if mf.Lyrics != "" {
		log.Trace(ctx, "embedded lyrics found in file", "title", mf.Title)
		list, err := mf.StructuredLyrics()
		return withLocalIdentity(mf, model.LyricsLocalKindEmbedded, "", "embedded",
			withLyricsSource(list, model.LyricsSource{Type: model.LyricsSourceEmbedded})), err
	}

	log.Trace(ctx, "no embedded lyrics for file", "path", mf.Title)

	return nil, nil
}

func fromExternalFile(ctx context.Context, mf *model.MediaFile, suffix string) (model.LyricList, error) {
	ext := path.Ext(mf.Path)
	sidecarRelPath := mf.Path[0:len(mf.Path)-len(ext)] + suffix
	ctx = log.NewContext(ctx, "file", sidecarRelPath)

	store, err := storage.For(mf.LibraryPath)
	if err != nil {
		return nil, fmt.Errorf("getting storage for library: %w", err)
	}
	fsys, err := store.FS()
	if err != nil {
		return nil, fmt.Errorf("opening library filesystem: %w", err)
	}

	f, err := fsys.Open(sidecarRelPath)
	if errors.Is(err, fs.ErrNotExist) {
		log.Trace(ctx, "no lyrics found at path")
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	defer f.Close()

	contents, err := io.ReadAll(ioutils.UTF8Reader(f))
	if err != nil {
		return nil, err
	}

	list, err := model.ParseLyrics(ctx, suffix, "xxx", contents)
	if err != nil {
		log.Error(ctx, "error parsing external lyric file", err)
		return nil, err
	}

	if len(list) == 0 {
		log.Trace(ctx, "empty lyrics from external file")
		return nil, nil
	}

	log.Trace(ctx, "retrieved lyrics from external file")
	format := strings.ToLower(strings.TrimPrefix(suffix, "."))
	return withLocalIdentity(mf, model.LyricsLocalKindSidecar, format, suffix,
		withLyricsSource(list, model.LyricsSource{
			Type:   model.LyricsSourceSidecar,
			Format: format,
		})), nil
}

// fromPlugin attempts to load legacy lyrics from a plugin with the given name.
// Results are cached, misses included: legacy clients ask for every track in a
// queue, and plugin lookups are slow.
func (l *lyricsService) fromPlugin(ctx context.Context, mf *model.MediaFile, pluginName string) (model.LyricList, error) {
	if l.pluginLoader == nil {
		log.Debug(ctx, "Invalid lyric source", "source", pluginName)
		return nil, nil
	}

	provider, ok := l.pluginLoader.LoadLyricsProvider(pluginName)
	if !ok {
		log.Warn(ctx, "Lyrics plugin not found", "plugin", pluginName)
		return nil, nil
	}

	key := pluginKey{plugin: pluginName, mediaFileID: mf.ID, trackKey: pluginTrackKey(mf)}
	list, err := l.pluginCacheFor().GetWithLoader(key, func(pluginKey) (model.LyricList, time.Duration, error) {
		// Concurrent callers share one load, so one cancelled request must not abort it for the others.
		loadCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), lyricsLoadTimeout)
		defer cancel()
		lyricsList, err := l.classicPluginLyrics(loadCtx, provider, mf)
		if err != nil {
			log.Error(ctx, "Error getting lyrics from plugin", "plugin", pluginName, err)
			return nil, 0, err
		}
		if len(lyricsList) > 0 {
			log.Trace(ctx, "Retrieved lyrics from plugin", "plugin", pluginName, "count", len(lyricsList))
		}
		return lyricsList, 0, nil
	})
	if err != nil {
		return nil, unwrapLyricsCacheError(err)
	}
	return list, nil
}

// classicPluginLyrics negotiates publication for a classic cache miss. A
// capable host never falls through to unconditional writes on denial; the
// adapter/plugin returns a retryable error or the currently committed snapshot.
func (l *lyricsService) classicPluginLyrics(ctx context.Context, provider Provider, mf *model.MediaFile) (model.LyricList, error) {
	if publication, ok := provider.(PublicationProvider); ok && publication.PublicationGeneration() != "" {
		call := model.LyricsPublication{Generation: publication.PublicationGeneration(), Kind: "classic"}
		list, _, _, err := publication.GetLyricsWithPublication(ctx, mf, call)
		if err != nil {
			return nil, err
		}
		// The adapter already called the required v1 export when the optional
		// classic export is unsupported; do not issue a second lookup.
		return list, nil
	}
	return provider.GetLyrics(ctx, mf)
}

func pluginTrackKey(mf *model.MediaFile) string {
	title := strings.ToLower(strings.TrimSpace(mf.Title))
	artist := strings.ToLower(strings.TrimSpace(mf.Artist))
	if title == "" || artist == "" {
		return ""
	}
	album := strings.ToLower(strings.TrimSpace(mf.Album))
	duration := int64(mf.Duration + 0.5)
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%s\x00%d", title, artist, album, duration)))
	return hex.EncodeToString(sum[:])
}

// fromPluginResult resolves one plugin source. Legacy lookups use the bounded
// upstream cache. Detailed lookups are single-flight but not retained: the
// provider can improve them after responding (for example from a background
// sweep), and enhanced clients poll for upgrades.
func (l *lyricsService) fromPluginResult(ctx context.Context, mf *model.MediaFile, pluginName string, detailed, refresh bool) (model.LyricsResult, error) {
	pluginSource := model.LyricsSource{Type: model.LyricsSourcePlugin, Name: pluginName}
	if !detailed {
		list, err := l.fromPlugin(ctx, mf, pluginName)
		if err != nil {
			return model.LyricsResult{}, err
		}
		return model.LyricsResult{Lyrics: withLyricsSource(list, pluginSource)}, nil
	}

	if l.pluginLoader == nil {
		log.Debug(ctx, "Invalid lyric source", "source", pluginName)
		return model.LyricsResult{}, nil
	}
	provider, ok := l.pluginLoader.LoadLyricsProvider(pluginName)
	if !ok {
		log.Warn(ctx, "Lyrics plugin not found", "plugin", pluginName)
		return model.LyricsResult{}, nil
	}

	if err := ctx.Err(); err != nil {
		return model.LyricsResult{}, err
	}
	var refreshPublication model.LyricsPublication
	prepare := func() error {
		publication, ok := provider.(PublicationProvider)
		if !ok || publication.PublicationGeneration() == "" {
			return nil
		}
		call, supported, err := publication.StartPublication(ctx, mf, "refresh")
		if err != nil {
			return err
		}
		if supported {
			refreshPublication = call
		}
		return nil
	}
	key := pluginName + "\x00" + mf.ID + "\x00" + pluginTrackKey(mf)
	result, err := l.detailed.do(ctx, key, refresh, prepare, func(loadCtx context.Context) (model.LyricsResult, error) {
		if publication, ok := provider.(PublicationProvider); ok && publication.PublicationGeneration() != "" {
			call := refreshPublication
			if call.Generation == "" {
				call = model.LyricsPublication{
					Generation: publication.PublicationGeneration(),
					Kind:       "normal",
				}
			}
			loaded, supported, loadErr := publication.GetLyricsDetailedResultWithRefresh(loadCtx, mf, call, refresh)
			if loadErr != nil {
				if refresh && refreshPublication.Generation != "" {
					_ = publication.AbortPublication(context.WithoutCancel(loadCtx), mf, refreshPublication)
				}
				return model.LyricsResult{}, loadErr
			}
			if supported {
				return loaded, nil
			}
			if refresh && refreshPublication.Generation != "" {
				_ = publication.AbortPublication(context.WithoutCancel(loadCtx), mf, refreshPublication)
			}
			// The adapter already returned the required v1 result; do not repeat
			// the provider call for an old plugin.
			return loaded, nil
		}
		return loadDetailedResult(loadCtx, provider, mf)
	})
	if err != nil {
		return model.LyricsResult{}, err
	}
	if len(result.Lyrics) > 0 {
		log.Trace(ctx, "Retrieved lyrics from plugin", "plugin", pluginName, "count", len(result.Lyrics))
	}
	result.Lyrics = withLyricsSource(result.Lyrics, pluginSource)
	return result, nil
}

func loadDetailedResult(ctx context.Context, provider Provider, mf *model.MediaFile) (model.LyricsResult, error) {
	if resultProvider, ok := provider.(DetailedResultProvider); ok {
		return resultProvider.GetLyricsDetailedResult(ctx, mf)
	}
	if detailedProvider, ok := provider.(DetailedProvider); ok {
		list, err := detailedProvider.GetLyricsDetailed(ctx, mf)
		return model.LyricsResult{Lyrics: list}, err
	}
	list, err := provider.GetLyrics(ctx, mf)
	return model.LyricsResult{Lyrics: list}, err
}

// unwrapLyricsCacheError restores the provider's original error after the
// cache has wrapped it with a transport prefix. Callers and the Subsonic retry
// parser keep the same identity and message as an uncached call.
func unwrapLyricsCacheError(err error) error {
	const prefix = "cache error: loader returned "
	if err == nil || !strings.HasPrefix(err.Error(), prefix) {
		return err
	}
	if unwrapped := errors.Unwrap(err); unwrapped != nil {
		return unwrapped
	}
	return err
}

// withLocalIdentity stamps one host-issued identity on every entry of a local
// source. Embedded and sidecar lyrics have no provider recording; the opaque
// identity is the durable address used by account-scoped personal choices.
func withLocalIdentity(mf *model.MediaFile, kind, format, discriminator string, list model.LyricList) model.LyricList {
	if len(list) == 0 || mf == nil {
		return list
	}
	language, role := localIdentityAttributes(list)
	identity := model.NewLyricsLocalIdentity(mf.ID, kind, format, language, role, discriminator)
	if !identity.Valid() {
		return list
	}
	result := make(model.LyricList, len(list))
	copy(result, list)
	for i := range result {
		stamped := identity
		result[i].Local = &stamped
	}
	return result
}

// localIdentityAttributes reports the variant's uniform main language, or an
// empty language for a mixed-language local document. The token itself does
// not depend on this presentation value.
func localIdentityAttributes(list model.LyricList) (string, string) {
	language := ""
	mixed := false
	for _, lyric := range list {
		if !lyric.IsMainKind() {
			continue
		}
		lang := strings.TrimSpace(lyric.Lang)
		if language == "" {
			language = lang
			continue
		}
		if lang != language {
			mixed = true
		}
	}
	if mixed {
		language = ""
	}
	return language, model.LyricKindMain
}

// LocalVariants lists the currently readable embedded and configured sidecar
// variants for mf. It performs the real local-file read and is the validation
// authority for durable local choices; it never invents an identity for an
// unavailable source.
func LocalVariants(ctx context.Context, mf *model.MediaFile) []model.LyricsLocalIdentity {
	if mf == nil {
		return nil
	}
	seen := map[string]bool{}
	identities := make([]model.LyricsLocalIdentity, 0, 2)
	add := func(list model.LyricList) {
		for _, lyric := range list {
			if lyric.Local == nil || !lyric.Local.Valid() || seen[lyric.Local.Token] {
				continue
			}
			seen[lyric.Local.Token] = true
			identities = append(identities, *lyric.Local)
		}
	}
	for pattern := range strings.SplitSeq(conf.Server().LyricsPriority, ",") {
		pattern = strings.TrimSpace(pattern)
		if !isLocalSource(pattern) {
			continue
		}
		var list model.LyricList
		var err error
		if strings.EqualFold(pattern, "embedded") {
			list, err = fromEmbedded(ctx, mf)
		} else {
			list, err = fromExternalFile(ctx, mf, pattern)
		}
		if err != nil {
			log.Debug(ctx, "local lyrics variant unavailable", "source", pattern, err)
			continue
		}
		add(list)
	}
	return identities
}

// withLyricsSource copies the lyric entries before adding defaults so resolver
// metadata does not mutate cached embedded lyrics or a provider-owned result.
func withLyricsSource(list model.LyricList, defaults model.LyricsSource) model.LyricList {
	if len(list) == 0 {
		return list
	}

	result := make(model.LyricList, len(list))
	copy(result, list)
	for i := range result {
		source := defaults
		if result[i].Source != nil {
			source = *result[i].Source
			if source.Type == "" {
				source.Type = defaults.Type
			}
			if source.Name == "" {
				source.Name = defaults.Name
			}
			if source.Provider == "" {
				source.Provider = defaults.Provider
			}
			if source.Format == "" {
				source.Format = defaults.Format
			}
		}
		result[i].Source = &source
	}
	return result
}
