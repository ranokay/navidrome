package plugins

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/stretchr/testify/require"
)

func newPublicationTestService(t *testing.T, folder, generation string) *kvstoreServiceImpl {
	t.Helper()
	conf.Update(func(c *conf.Options) { c.DataFolder = conf.NewDir(folder) })
	service, err := newKVStoreService(t.Context(), "publication_test", &KVStorePermission{MaxSize: new("32MB")}, generation)
	require.NoError(t, err)
	t.Cleanup(func() { _ = service.Close() })
	return service
}

func admitTestPublication(t *testing.T, service *kvstoreServiceImpl, generation, track, kind, requestID string) publicationAdmissionResponse {
	t.Helper()
	request, err := json.Marshal(publicationAdmissionRequest{
		Version: publicationVersion, Action: "admit", RequestID: requestID,
		Generation: generation, Track: track, Scope: "scope", Kind: kind,
	})
	require.NoError(t, err)
	require.NoError(t, service.SetWithTTL(t.Context(), publicationAdmissionPrefix+track, request, 1800))
	raw, exists, err := service.Get(t.Context(), publicationAdmissionPrefix+track)
	require.NoError(t, err)
	require.True(t, exists)
	var response publicationAdmissionResponse
	require.NoError(t, json.Unmarshal(raw, &response))
	return response
}

func testCommit(t *testing.T, generation, token, track string) []byte {
	t.Helper()
	return testAggregateCommit(t, generation, token, track, false, 0)
}

func TestPublicationAdmissionRejectsSupersededWriter(t *testing.T) {
	folder := t.TempDir()
	generation := "generation-1"
	service := newPublicationTestService(t, folder, generation)
	track := "track-1"
	older := admitTestPublication(t, service, generation, track, "classic", "call-old")
	require.True(t, older.Accepted)
	refresh := admitTestPublication(t, service, generation, track, "refresh", "call-new")
	require.True(t, refresh.Accepted)

	// Refresh is admitted but has not committed yet: the older classic writer
	// must already be unable to publish.
	require.Error(t, service.commitPublication(t.Context(), track, testCommit(t, generation, older.Token, track)))

	require.NoError(t, service.commitPublication(t.Context(), track, testCommit(t, generation, refresh.Token, track)))
	raw, exists, err := service.Get(t.Context(), publicationState+track)
	require.NoError(t, err)
	require.True(t, exists)
	var state publicationStateResponse
	require.NoError(t, json.Unmarshal(raw, &state))
	require.NotEmpty(t, state.Revision)

	require.Error(t, service.commitPublication(t.Context(), track, testCommit(t, generation, older.Token, track)))

	// Result eviction does not remove the authoritative admission. The old
	// writer remains rejected after the published rows disappear.
	_, err = service.db.ExecContext(t.Context(), `DELETE FROM kvstore WHERE key LIKE ?`, "lyrics:v5:source:lrclib:"+track)
	require.NoError(t, err)
	require.Error(t, service.commitPublication(t.Context(), track, testCommit(t, generation, older.Token, track)))

	// A reload mints a new generation; the old token cannot be reused even
	// when the scope string would match.
	service2 := newPublicationTestService(t, folder, "generation-2")
	require.Error(t, service2.commitPublication(t.Context(), track, testCommit(t, "generation-2", older.Token, track)))
	require.Error(t, service2.commitPublication(t.Context(), track, testCommit(t, generation, older.Token, track)))
}

func TestPublicationReservedStateCannotBeDeleted(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	require.Error(t, service.Delete(t.Context(), publicationState+"track-1"))
	require.Error(t, service.Delete(t.Context(), publicationActiveKey))
	_, err := service.DeleteByPrefix(t.Context(), publicationPrefix)
	require.Error(t, err)
}

func TestPublicationQuotaFailureRollsBackWholeBatch(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	service.maxSize = 4
	track := "track-1"
	admission := admitTestPublication(t, service, "generation-1", track, "classic", "call")
	require.True(t, admission.Accepted)
	require.Error(t, service.commitPublication(t.Context(), track, testCommit(t, "generation-1", admission.Token, track)))
	_, exists, err := service.Get(t.Context(), publicationState+track)
	require.NoError(t, err)
	require.False(t, exists)
	_, exists, err = service.Get(t.Context(), "lyrics:v5:source:lrclib:"+track)
	require.NoError(t, err)
	require.False(t, exists)
}

func TestPublicationAdmissionResumeIsExact(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	admission := admitTestPublication(t, service, "generation-1", track, "sweep", "call")
	require.True(t, admission.Accepted)
	admitTestPublication(t, service, "generation-1", track, "refresh", "newer")

	resume, err := json.Marshal(publicationAdmissionRequest{
		Version: publicationVersion, Action: "resume", RequestID: "call",
		Generation: "generation-1", Track: track, Scope: "scope", Kind: "sweep", Token: admission.Token,
	})
	require.NoError(t, err)
	require.Error(t, service.admitPublication(t.Context(), track, resume))

	current := admitTestPublication(t, service, "generation-1", track, "refresh", "current")
	resume, err = json.Marshal(publicationAdmissionRequest{
		Version: publicationVersion, Action: "resume", RequestID: "current",
		Generation: "generation-1", Track: track, Scope: "scope", Kind: "refresh", Token: current.Token,
	})
	require.NoError(t, err)
	require.NoError(t, service.admitPublication(t.Context(), track, resume))
}

func TestPublicationRejectsDuplicateWriteKeys(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	admission := admitTestPublication(t, service, "generation-1", track, "classic", "call")
	require.True(t, admission.Accepted)
	write := publicationWrite{Key: "lyrics:v5:source:lrclib:" + track, Value: []byte("snapshot"), TTL: 300}
	digest := publicationDigest([]publicationWrite{write, write}, track, true)
	batch := publicationCommitRequest{
		Version: publicationVersion, Generation: "generation-1", Token: admission.Token, Track: track,
		Scope: "scope", Revision: publicationRevision("generation-1", track, digest),
		SnapshotDigest: digest, Complete: true, Writes: []publicationWrite{write, write},
	}
	raw, err := json.Marshal(batch)
	require.NoError(t, err)
	require.Error(t, service.commitPublication(t.Context(), track, raw))
}

func TestExpiredAdmissionIsAbsentAndResumeRejected(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	admission := admitTestPublication(t, service, "generation-1", track, "classic", "call")
	require.True(t, admission.Accepted)
	_, err := service.db.ExecContext(t.Context(), `UPDATE plugin_publication_admissions SET expires_at=datetime('now','-1 minute') WHERE track_key=?`, track)
	require.NoError(t, err)
	_, exists, err := service.Get(t.Context(), publicationAdmissionPrefix+track)
	require.NoError(t, err)
	require.False(t, exists)
	has, err := service.Has(t.Context(), publicationAdmissionPrefix+track)
	require.NoError(t, err)
	require.False(t, has)
	resume, err := json.Marshal(publicationAdmissionRequest{
		Version: publicationVersion, Action: "resume", RequestID: "call",
		Generation: "generation-1", Track: track, Kind: "classic", Token: admission.Token,
	})
	require.NoError(t, err)
	require.Error(t, service.admitPublication(t.Context(), track, resume))
}

func TestGetManyIncludesPublicationRecords(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	admission := admitTestPublication(t, service, "generation-1", track, "classic", "call")
	require.True(t, admission.Accepted)
	values, err := service.GetMany(t.Context(), []string{publicationAdmissionPrefix + track, publicationActiveKey})
	require.NoError(t, err)
	require.Contains(t, values, publicationAdmissionPrefix+track)
	require.Contains(t, values, publicationActiveKey)
}

func TestPublicationRejectsTamperedSnapshotDigest(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	admission := admitTestPublication(t, service, "generation-1", track, "classic", "call")
	require.True(t, admission.Accepted)
	raw := testCommit(t, "generation-1", admission.Token, track)
	var batch publicationCommitRequest
	require.NoError(t, json.Unmarshal(raw, &batch))
	batch.Writes[0].Value = []byte("tampered")
	raw, err := json.Marshal(batch)
	require.NoError(t, err)
	require.Error(t, service.commitPublication(t.Context(), track, raw))
}

func TestPublicationDigestCanonicalForm(t *testing.T) {
	write := publicationWrite{Key: "lyrics:v5:source:lrclib:track-1", Value: []byte("snapshot"), TTL: 300}
	const expected = "e949adc58a9ca6d01ab4ea216421e10af619a14e2b2946153e7cda4937b3131b"
	if got := publicationDigest([]publicationWrite{write}, "track-1", true); got != expected {
		t.Fatalf("publicationDigest = %s, want %s", got, expected)
	}
}

func TestHostAdmittedRefreshAcceptsPluginScope(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	token, err := service.AdmitHost(t.Context(), "generation-1", track, "refresh", "host-call")
	require.NoError(t, err)
	require.NotEmpty(t, token)
	write := publicationWrite{Key: "lyrics:v5:source:lrclib:" + track, Value: []byte("snapshot"), TTL: 300}
	digest := publicationDigest([]publicationWrite{write}, track, true)
	batch := publicationCommitRequest{
		Version: publicationVersion, Generation: "generation-1", Token: token, Track: track,
		Scope: "plugin-scope", Revision: publicationRevision("generation-1", track, digest),
		SnapshotDigest: digest, Complete: true, Writes: []publicationWrite{write},
	}
	raw, err := json.Marshal(batch)
	require.NoError(t, err)
	require.NoError(t, service.commitPublication(t.Context(), track, raw))
}

func TestPluginMintedEmptyScopeCannotCommit(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	request, err := json.Marshal(publicationAdmissionRequest{
		Version: publicationVersion, Action: "admit", RequestID: "call",
		Generation: "generation-1", Track: track, Kind: "refresh",
	})
	require.NoError(t, err)
	require.NoError(t, service.SetWithTTL(t.Context(), publicationAdmissionPrefix+track, request, 1800))
	rawAdmission, exists, err := service.Get(t.Context(), publicationAdmissionPrefix+track)
	require.NoError(t, err)
	require.True(t, exists)
	var admission publicationAdmissionResponse
	require.NoError(t, json.Unmarshal(rawAdmission, &admission))
	require.True(t, admission.Accepted)
	raw := testCommit(t, "generation-1", admission.Token, track)
	var batch publicationCommitRequest
	require.NoError(t, json.Unmarshal(raw, &batch))
	batch.Scope = "plugin-scope"
	raw, err = json.Marshal(batch)
	require.NoError(t, err)
	require.Error(t, service.commitPublication(t.Context(), track, raw))
}

func testAggregateCommit(t *testing.T, generation, token, track string, awaitTail bool, snapshotExpiresAt int64) []byte {
	t.Helper()
	write := publicationWrite{Key: "lyrics:v5:source:lrclib:" + track, Value: []byte("snapshot"), TTL: 300}
	digest := publicationDigest([]publicationWrite{write}, track, true)
	batch := publicationCommitRequest{
		Version: publicationVersion, Generation: generation, Token: token, Track: track,
		Scope: "scope", Revision: publicationRevision(generation, track, digest),
		SnapshotDigest: digest, Complete: true, AwaitTail: awaitTail,
		SnapshotExpiresAt: snapshotExpiresAt,
		Writes:            []publicationWrite{write},
	}
	raw, err := json.Marshal(batch)
	require.NoError(t, err)
	return raw
}

func TestPublicationStateRequiresActiveGeneration(t *testing.T) {
	folder := t.TempDir()
	generation := "generation-1"
	service := newPublicationTestService(t, folder, generation)
	track := "track-1"
	admission := admitTestPublication(t, service, generation, track, "classic", "call")
	require.True(t, admission.Accepted)
	require.NoError(t, service.commitPublication(t.Context(), track, testAggregateCommit(t, generation, admission.Token, track, false, 0)))

	raw, exists, err := service.Get(t.Context(), publicationState+track)
	require.NoError(t, err)
	require.True(t, exists)
	var state publicationStateResponse
	require.NoError(t, json.Unmarshal(raw, &state))
	require.Equal(t, generation, state.Generation)
	require.Equal(t, "scope", state.Scope)

	// A reload mints a new generation: persisted state from the old generation
	// is no longer authoritative even while its rows remain in the database.
	reloaded := newPublicationTestService(t, folder, "generation-2")
	_, exists, err = reloaded.Get(t.Context(), publicationState+track)
	require.NoError(t, err)
	require.False(t, exists)
}

func TestPublicationStateExpiryBoundedBySnapshotDependencies(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	admission := admitTestPublication(t, service, "generation-1", track, "classic", "call")
	require.True(t, admission.Accepted)
	require.NoError(t, service.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-1", admission.Token, track, false, time.Now().Unix()-1)))

	// The published rows committed, but their reused dependency already
	// expired, so the state claim must not outlive it.
	_, exists, err := service.Get(t.Context(), publicationState+track)
	require.NoError(t, err)
	require.False(t, exists)
	_, exists, err = service.Get(t.Context(), "lyrics:v5:source:lrclib:"+track)
	require.NoError(t, err)
	require.True(t, exists)
}

func TestCommittedRefreshDoesNotBlockForegroundWriters(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	refresh := admitTestPublication(t, service, "generation-1", track, "refresh", "refresh")
	require.True(t, refresh.Accepted)
	require.NoError(t, service.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-1", refresh.Token, track, false, 0)))

	classic := admitTestPublication(t, service, "generation-1", track, "classic", "classic")
	require.True(t, classic.Accepted, "a committed refresh must not block foreground work")
}

func TestAwaitTailRefreshKeepsAdmissionUntilReleased(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	refresh := admitTestPublication(t, service, "generation-1", track, "refresh", "refresh")
	require.True(t, refresh.Accepted)
	require.NoError(t, service.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-1", refresh.Token, track, true, 0)))

	sweepRequest, err := json.Marshal(publicationAdmissionRequest{
		Version: publicationVersion, Action: "admit", RequestID: "sweep",
		Generation: "generation-1", Track: track, Scope: "scope", Kind: "sweep",
	})
	require.NoError(t, err)
	require.Error(t, service.admitPublication(t.Context(), track, sweepRequest))

	// The tail commits under the same token and moves the admission to
	// committed before the terminal release.
	require.NoError(t, service.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-1", refresh.Token, track, false, 0)))

	release, err := json.Marshal(publicationAdmissionRequest{
		Version: publicationVersion, Action: "release", Generation: "generation-1",
		Track: track, Token: refresh.Token,
	})
	require.NoError(t, err)
	require.NoError(t, service.admitPublication(t.Context(), track, release))
	require.NoError(t, service.admitPublication(t.Context(), track, sweepRequest))
}

func TestReloadRetiresOldGenerationAdmissions(t *testing.T) {
	folder := t.TempDir()
	track := "track-1"
	service := newPublicationTestService(t, folder, "generation-1")
	refresh := admitTestPublication(t, service, "generation-1", track, "refresh", "refresh")
	require.True(t, refresh.Accepted)
	require.NoError(t, service.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-1", refresh.Token, track, true, 0)))

	// A reload mints a new generation. The awaiting tail's admission must not
	// keep blocking foreground writers, and its token must not publish a
	// snapshot as the new generation.
	reloaded := newPublicationTestService(t, folder, "generation-2")
	classic := admitTestPublication(t, reloaded, "generation-2", track, "classic", "classic")
	require.True(t, classic.Accepted, "an old-generation admission blocked the reloaded host")
	require.Error(t, reloaded.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-2", refresh.Token, track, false, 0)))
}

func TestCommitRejectsAdmissionFromAnotherGeneration(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	admission := admitTestPublication(t, service, "generation-1", track, "classic", "call")
	require.True(t, admission.Accepted)
	// Simulate a row that survived without being retired: the admission's
	// generation must still match the batch generation in the same transaction.
	_, err := service.db.ExecContext(t.Context(),
		`UPDATE plugin_publication_admissions SET generation='other-generation' WHERE track_key=?`, track)
	require.NoError(t, err)
	require.Error(t, service.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-1", admission.Token, track, false, 0)))
}

func TestReleasedAdmissionTokenCannotCommit(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	admission := admitTestPublication(t, service, "generation-1", track, "classic", "call")
	require.True(t, admission.Accepted)
	require.NoError(t, service.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-1", admission.Token, track, false, 0)))

	release, err := json.Marshal(publicationAdmissionRequest{
		Version: publicationVersion, Action: "release", Generation: "generation-1",
		Track: track, Token: admission.Token,
	})
	require.NoError(t, err)
	require.NoError(t, service.admitPublication(t.Context(), track, release))
	require.Error(t, service.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-1", admission.Token, track, false, 0)))
}

func TestCommittedForegroundDoesNotBlockSweeps(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	classic := admitTestPublication(t, service, "generation-1", track, "classic", "classic")
	require.True(t, classic.Accepted)
	require.NoError(t, service.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-1", classic.Token, track, false, 0)))

	sweep := admitTestPublication(t, service, "generation-1", track, "sweep", "sweep")
	require.True(t, sweep.Accepted, "a committed foreground admission blocked the sweep")
}

func TestAdmissionPolicyIgnoresAStaleGenerationRow(t *testing.T) {
	service := newPublicationTestService(t, t.TempDir(), "generation-1")
	track := "track-1"
	admission := admitTestPublication(t, service, "generation-1", track, "classic", "classic")
	require.True(t, admission.Accepted)
	_, err := service.db.ExecContext(t.Context(), `
		UPDATE plugin_publication_admissions
		SET generation='old-generation', state='active', expires_at=datetime('now','+30 minutes')
		WHERE track_key=?`, track)
	require.NoError(t, err)

	sweep := admitTestPublication(t, service, "generation-1", track, "sweep", "sweep")
	require.True(t, sweep.Accepted, "a stale-generation active row blocked the live generation")
}

func TestPublicationSchemaUpgradesFromPreviousVersion(t *testing.T) {
	folder := t.TempDir()
	track := "track-1"
	service := newPublicationTestService(t, folder, "generation-1")
	admission := admitTestPublication(t, service, "generation-1", track, "classic", "classic")
	require.True(t, admission.Accepted)
	require.NoError(t, service.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-1", admission.Token, track, true, 0)))
	require.NoError(t, service.Close())

	db, err := sql.Open("sqlite3", filepath.Join(folder, "plugins", "publication_test", "kvstore.db")+"?_busy_timeout=5000&_journal_mode=WAL")
	require.NoError(t, err)
	_, err = db.Exec(`ALTER TABLE plugin_publication_state DROP COLUMN generation`)
	require.NoError(t, err)
	_, err = db.Exec(`PRAGMA user_version = 6`)
	require.NoError(t, err)
	require.NoError(t, db.Close())

	// Reopening applies migration 7 and makes the old row invisible to the
	// new generation while leaving the legacy row in place.
	reloaded := newPublicationTestService(t, folder, "generation-2")
	_, exists, err := reloaded.Get(t.Context(), publicationState+track)
	require.NoError(t, err)
	require.False(t, exists)

	next := admitTestPublication(t, reloaded, "generation-2", track, "classic", "next")
	require.True(t, next.Accepted)
	require.NoError(t, reloaded.commitPublication(t.Context(), track,
		testAggregateCommit(t, "generation-2", next.Token, track, false, 0)))
	_, exists, err = reloaded.Get(t.Context(), publicationState+track)
	require.NoError(t, err)
	require.True(t, exists)
}
