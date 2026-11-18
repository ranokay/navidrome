package plugins

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

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

func publicationDigestForTest(writes []publicationWrite, track string, complete bool) string {
	hash := sha256.New()
	for _, write := range writes {
		hash.Write([]byte(write.Key))
		hash.Write([]byte{0})
		hash.Write(write.Value)
		hash.Write([]byte{0})
	}
	hash.Write([]byte(track))
	if complete {
		hash.Write([]byte{1})
	} else {
		hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func testCommit(t *testing.T, generation, token, track string) []byte {
	t.Helper()
	write := publicationWrite{Key: "lyrics:v5:source:lrclib:" + track, Value: []byte("snapshot"), TTL: 300}
	digest := publicationDigestForTest([]publicationWrite{write}, track, true)
	batch := publicationCommitRequest{
		Version: publicationVersion, Generation: generation, Token: token, Track: track,
		Scope: "scope", Revision: publicationRevision(generation, track, digest),
		SnapshotDigest: digest, Complete: true, Writes: []publicationWrite{write},
	}
	raw, err := json.Marshal(batch)
	require.NoError(t, err)
	return raw
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
		Generation: "generation-1", Track: track, Kind: "sweep", Token: admission.Token,
	})
	require.NoError(t, err)
	require.Error(t, service.admitPublication(t.Context(), track, resume))

	current := admitTestPublication(t, service, "generation-1", track, "refresh", "current")
	resume, err = json.Marshal(publicationAdmissionRequest{
		Version: publicationVersion, Action: "resume", RequestID: "current",
		Generation: "generation-1", Track: track, Kind: "refresh", Token: current.Token,
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
	digest := publicationDigestForTest([]publicationWrite{write, write}, track, true)
	batch := publicationCommitRequest{
		Version: publicationVersion, Generation: "generation-1", Token: admission.Token, Track: track,
		Scope: "scope", Revision: publicationRevision("generation-1", track, digest),
		SnapshotDigest: digest, Complete: true, Writes: []publicationWrite{write, write},
	}
	raw, err := json.Marshal(batch)
	require.NoError(t, err)
	require.Error(t, service.commitPublication(t.Context(), track, raw))
}
