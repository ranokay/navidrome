package plugins

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/navidrome/navidrome/log"
)

// The publication protocol reuses the existing KV host functions so old hosts
// keep loading the plugin. Only the live host call metadata tells the plugin
// that this host implements the reserved admission/commit protocol.
const (
	publicationPrefix          = "@navidrome/publication/"
	publicationActiveKey       = publicationPrefix + "active"
	publicationAdmissionPrefix = publicationPrefix + "admission:"
	publicationCommit          = publicationPrefix + "commit:"
	publicationState           = publicationPrefix + "state:"
	publicationVersion         = 1
	publicationTTL             = 30 * time.Minute
	publicationStateTTL        = 24 * time.Hour
	maxPublicationWrites       = 64
	maxPublicationBytes        = 16 << 20
	maxPublicationEntrySize    = 1 << 20
	publicationReservedBytes   = 1 << 20
)

var errPublicationRejected = errors.New("publication rejected")

type publicationAdmissionRequest struct {
	Version    int    `json:"version"`
	Action     string `json:"action"`
	RequestID  string `json:"requestId"`
	Generation string `json:"generation"`
	Track      string `json:"track"`
	Scope      string `json:"scope"`
	Kind       string `json:"kind"`
	Token      string `json:"token"`
}

type publicationAdmissionResponse struct {
	Handled    bool   `json:"handled"`
	Accepted   bool   `json:"accepted"`
	RequestID  string `json:"requestId,omitempty"`
	Generation string `json:"generation,omitempty"`
	Token      string `json:"token,omitempty"`
	State      string `json:"state,omitempty"`
	Reason     string `json:"reason,omitempty"`
}

type publicationWrite struct {
	Key   string `json:"key"`
	Value []byte `json:"value"`
	TTL   int64  `json:"ttl"`
}

type publicationCommitRequest struct {
	Version        int                `json:"version"`
	Generation     string             `json:"generation"`
	Token          string             `json:"token"`
	Track          string             `json:"track"`
	Scope          string             `json:"scope"`
	Revision       string             `json:"revision"`
	SnapshotDigest string             `json:"snapshotDigest"`
	Complete       bool               `json:"complete"`
	Writes         []publicationWrite `json:"writes"`
}

type publicationStateResponse struct {
	Handled  bool   `json:"handled"`
	Revision string `json:"revision,omitempty"`
	Complete bool   `json:"complete,omitempty"`
}

type publicationActiveResponse struct {
	Handled    bool   `json:"handled"`
	Generation string `json:"generation"`
}

// AdmitHost mints a host-owned admission for an API-triggered refresh before
// the plugin is called, so an older sweep is superseded immediately.
func (s *kvstoreServiceImpl) AdmitHost(ctx context.Context, generation, track, kind, requestID string) (string, error) {
	request, err := json.Marshal(publicationAdmissionRequest{
		Version: publicationVersion, Action: "admit", RequestID: requestID,
		Generation: generation, Track: track, Kind: kind,
	})
	if err != nil {
		return "", err
	}
	if err := s.admitPublication(ctx, track, request); err != nil {
		return "", err
	}
	row, exists, err := s.readAdmission(ctx, track)
	if err != nil || !exists {
		return "", err
	}
	return row.Token, nil
}

// ReleaseHost releases an abandoned API-triggered refresh admission.
func (s *kvstoreServiceImpl) ReleaseHost(ctx context.Context, generation, track, token string) error {
	request, err := json.Marshal(publicationAdmissionRequest{
		Version: publicationVersion, Action: "release", Generation: generation,
		Track: track, Token: token,
	})
	if err != nil {
		return err
	}
	return s.admitPublication(ctx, track, request)
}

func randomPublicationToken(bytes int) string {
	value := make([]byte, bytes)
	if _, err := rand.Read(value); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	return hex.EncodeToString(value)
}

func publicationRevision(generation, track, digest string) string {
	sum := sha256.Sum256([]byte("navidrome-better-lyrics/publication/v1\x00" + generation + "\x00" + track + "\x00" + digest))
	return hex.EncodeToString(sum[:16])
}

func isPublicationKey(key string) bool {
	return strings.HasPrefix(key, publicationPrefix)
}

// seedGeneration makes the new host generation authoritative before the
// reloaded plugin can run.
func (s *kvstoreServiceImpl) seedGeneration(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO plugin_publication_generation (id, generation, updated_at)
		VALUES (1, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET generation = excluded.generation, updated_at = CURRENT_TIMESTAMP
	`, s.generation)
	return err
}

func (s *kvstoreServiceImpl) currentGeneration(ctx context.Context) (string, error) {
	var generation string
	err := s.db.QueryRowContext(ctx, `SELECT generation FROM plugin_publication_generation WHERE id = 1`).Scan(&generation)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return generation, err
}

func (s *kvstoreServiceImpl) handlePublicationSet(ctx context.Context, key string, value []byte, ttlSeconds int64) error {
	switch {
	case strings.HasPrefix(key, publicationAdmissionPrefix):
		track := strings.TrimPrefix(key, publicationAdmissionPrefix)
		err := s.admitPublication(ctx, track, value)
		return err
	case strings.HasPrefix(key, publicationCommit):
		track := strings.TrimPrefix(key, publicationCommit)
		return s.commitPublication(ctx, track, value)
	default:
		return fmt.Errorf("%w: reserved publication key", errPublicationRejected)
	}
}

func (s *kvstoreServiceImpl) handlePublicationGet(ctx context.Context, key string) ([]byte, bool, error) {
	switch {
	case key == publicationActiveKey:
		generation, err := s.currentGeneration(ctx)
		if err != nil || generation == "" {
			return nil, false, err
		}
		value, err := json.Marshal(publicationActiveResponse{Handled: true, Generation: generation})
		return value, err == nil, err
	case strings.HasPrefix(key, publicationAdmissionPrefix):
		track := strings.TrimPrefix(key, publicationAdmissionPrefix)
		return s.admissionResponse(ctx, track)
	case strings.HasPrefix(key, publicationState):
		track := strings.TrimPrefix(key, publicationState)
		return s.stateResponse(ctx, track)
	}
	return nil, false, nil
}

func (s *kvstoreServiceImpl) admitPublication(ctx context.Context, track string, payload []byte) error {
	var request publicationAdmissionRequest
	if err := json.Unmarshal(payload, &request); err != nil || request.Version != publicationVersion || track == "" {
		return fmt.Errorf("%w: invalid admission", errPublicationRejected)
	}
	generation, err := s.currentGeneration(ctx)
	if err != nil {
		return err
	}
	if generation == "" || request.Generation != generation {
		return fmt.Errorf("%w: generation changed", errPublicationRejected)
	}
	s.publicationMu.Lock()
	defer s.publicationMu.Unlock()
	current, exists, err := s.readAdmission(ctx, track)
	if err != nil {
		return err
	}
	switch request.Action {
	case "release":
		return s.releaseAdmission(ctx, track, request, current, exists)
	case "resume":
		if !exists || current.Generation != request.Generation || current.Token != request.Token || current.State == "released" {
			return fmt.Errorf("%w: stale admission", errPublicationRejected)
		}
		return nil
	case "admit":
		if err := admissionPolicy(request.Kind, current, exists); err != nil {
			return err
		}
		return s.storeAdmission(ctx, track, generation, request)
	default:
		return fmt.Errorf("%w: unknown action", errPublicationRejected)
	}
}

func (s *kvstoreServiceImpl) releaseAdmission(ctx context.Context, track string, request publicationAdmissionRequest, current publicationAdmission, exists bool) error {
	if exists && current.Generation == request.Generation && current.Token == request.Token {
		_, _ = s.db.ExecContext(ctx, `UPDATE plugin_publication_admissions SET state='released', expires_at=datetime('now') WHERE track_key=?`, track)
	}
	return nil
}

// admissionPolicy is single-writer: refresh supersedes everything; ordinary
// foreground work cannot supersede an active refresh/tail; sweeps cannot
// supersede an active foreground writer.
func admissionPolicy(kind string, current publicationAdmission, exists bool) error {
	if !exists || !current.Valid || kind == "refresh" {
		return nil
	}
	if current.Kind == "refresh" || current.Kind == "tail" {
		return fmt.Errorf("%w: refresh active", errPublicationRejected)
	}
	if (kind == "sweep" || kind == "tail") && (current.Kind == "classic" || current.Kind == "normal" || current.Kind == "original") {
		return fmt.Errorf("%w: foreground active", errPublicationRejected)
	}
	return nil
}

func (s *kvstoreServiceImpl) storeAdmission(ctx context.Context, track, generation string, request publicationAdmissionRequest) error {
	token := randomPublicationToken(16)
	expires := time.Now().Add(publicationTTL)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO plugin_publication_admissions
			(track_key, generation, token, request_id, kind, scope, state, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
		ON CONFLICT(track_key) DO UPDATE SET
			generation=excluded.generation, token=excluded.token, request_id=excluded.request_id,
			kind=excluded.kind, scope=excluded.scope, state='active', expires_at=excluded.expires_at
	`, track, generation, token, request.RequestID, request.Kind, request.Scope, expires.UTC().Format("2006-01-02 15:04:05"))
	return err
}

type publicationAdmission struct {
	Generation string
	Token      string
	RequestID  string
	Kind       string
	Scope      string
	State      string
	Valid      bool
}

func (s *kvstoreServiceImpl) readAdmission(ctx context.Context, track string) (publicationAdmission, bool, error) {
	var row publicationAdmission
	var valid int
	err := s.db.QueryRowContext(ctx, `
		SELECT generation, token, request_id, kind, scope, state,
			CASE WHEN expires_at > CURRENT_TIMESTAMP THEN 1 ELSE 0 END
		FROM plugin_publication_admissions WHERE track_key = ?
	`, track).Scan(&row.Generation, &row.Token, &row.RequestID, &row.Kind, &row.Scope, &row.State, &valid)
	if errors.Is(err, sql.ErrNoRows) {
		return publicationAdmission{}, false, nil
	}
	if err != nil {
		return publicationAdmission{}, false, err
	}
	row.Valid = valid == 1
	return row, true, nil
}

func (s *kvstoreServiceImpl) admissionResponse(ctx context.Context, track string) ([]byte, bool, error) {
	row, exists, err := s.readAdmission(ctx, track)
	if err != nil || !exists {
		return nil, false, err
	}
	response := publicationAdmissionResponse{
		Handled: true, Accepted: row.Valid, RequestID: row.RequestID,
		Generation: row.Generation, Token: row.Token, State: row.State,
	}
	value, err := json.Marshal(response)
	return value, err == nil, err
}

func (s *kvstoreServiceImpl) stateResponse(ctx context.Context, track string) ([]byte, bool, error) {
	var revision string
	var complete bool
	err := s.db.QueryRowContext(ctx, `
		SELECT revision, complete FROM plugin_publication_state
		WHERE track_key = ? AND expires_at > CURRENT_TIMESTAMP
	`, track).Scan(&revision, &complete)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	value, err := json.Marshal(publicationStateResponse{Handled: true, Revision: revision, Complete: complete})
	return value, err == nil, err
}

// commitPublication is the host-owned conditional publication transaction.
// The admission token and live generation are checked in the same transaction
// as every write, revision and completion record.
func (s *kvstoreServiceImpl) commitPublication(ctx context.Context, track string, payload []byte) error {
	var batch publicationCommitRequest
	if err := json.Unmarshal(payload, &batch); err != nil || batch.Version != publicationVersion || track == "" || batch.Track != track {
		return fmt.Errorf("%w: invalid commit", errPublicationRejected)
	}
	if err := validateCommitBatch(batch, track); err != nil {
		return err
	}
	s.publicationMu.Lock()
	defer s.publicationMu.Unlock()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := s.applyCommitTx(ctx, tx, track, batch); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	log.Trace(ctx, "Plugin publication committed", "plugin", s.pluginName, "track", track, "revision", batch.Revision, "complete", batch.Complete)
	return nil
}

func validateCommitBatch(batch publicationCommitRequest, track string) error {
	if len(batch.Writes) == 0 || len(batch.Writes) > maxPublicationWrites || batch.Revision == "" {
		return fmt.Errorf("%w: invalid batch bounds", errPublicationRejected)
	}
	total := 0
	seen := make(map[string]bool, len(batch.Writes))
	for _, write := range batch.Writes {
		if err := validateCommitWrite(write, track); err != nil {
			return err
		}
		if seen[write.Key] {
			return fmt.Errorf("%w: duplicate write key", errPublicationRejected)
		}
		seen[write.Key] = true
		total += len(write.Value)
	}
	if total > maxPublicationBytes {
		return fmt.Errorf("%w: batch too large", errPublicationRejected)
	}
	if got := publicationRevision(batch.Generation, track, batch.SnapshotDigest); got != batch.Revision {
		return fmt.Errorf("%w: revision mismatch", errPublicationRejected)
	}
	return nil
}

func validateCommitWrite(write publicationWrite, track string) error {
	if write.TTL <= 0 || write.TTL > int64(publicationStateTTL/time.Second) || len(write.Value) > maxPublicationEntrySize || !strings.Contains(write.Key, track) {
		return fmt.Errorf("%w: write out of scope", errPublicationRejected)
	}
	if !strings.HasPrefix(write.Key, "lyrics:v5:") && !strings.HasPrefix(write.Key, "sweep-done:") {
		return fmt.Errorf("%w: write prefix not allowed", errPublicationRejected)
	}
	return nil
}

func (s *kvstoreServiceImpl) applyCommitTx(ctx context.Context, tx *sql.Tx, track string, batch publicationCommitRequest) error {
	generation, err := currentGenerationTx(ctx, tx)
	if err != nil {
		return err
	}
	if generation == "" || generation != batch.Generation {
		return fmt.Errorf("%w: generation changed", errPublicationRejected)
	}
	var token, state string
	var valid int
	err = tx.QueryRowContext(ctx, `
		SELECT token, state, CASE WHEN expires_at > CURRENT_TIMESTAMP THEN 1 ELSE 0 END
		FROM plugin_publication_admissions WHERE track_key = ?
	`, track).Scan(&token, &state, &valid)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: no admission", errPublicationRejected)
	}
	if err != nil {
		return err
	}
	if token != batch.Token || state == "released" || valid != 1 {
		return fmt.Errorf("%w: stale admission", errPublicationRejected)
	}
	if err := s.checkCommitQuota(ctx, tx, batch.Writes); err != nil {
		return err
	}
	if err := writeCommitEntries(ctx, tx, batch.Writes); err != nil {
		return err
	}
	if err := writeCommitState(ctx, tx, track, batch); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE plugin_publication_admissions SET state='committed', expires_at=? WHERE track_key=?`, time.Now().Add(publicationTTL).UTC().Format("2006-01-02 15:04:05"), track)
	return err
}

func (s *kvstoreServiceImpl) checkCommitQuota(ctx context.Context, tx *sql.Tx, writes []publicationWrite) error {
	used, err := storageUsedTx(ctx, tx)
	if err != nil {
		return err
	}
	delta := int64(0)
	for _, write := range writes {
		var oldSize int64
		err := tx.QueryRowContext(ctx, `SELECT COALESCE(size,0) FROM kvstore WHERE key = ?`, write.Key).Scan(&oldSize)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		delta += int64(len(write.Value)) - oldSize
	}
	budget := s.maxSize
	if budget > publicationReservedBytes {
		budget -= publicationReservedBytes
	}
	if used+delta > budget {
		return fmt.Errorf("%w: storage limit", errPublicationRejected)
	}
	return nil
}

func writeCommitEntries(ctx context.Context, tx *sql.Tx, writes []publicationWrite) error {
	for _, write := range writes {
		expiresAt := fmt.Sprintf("+%d seconds", write.TTL)
		_, err := tx.ExecContext(ctx, `
			INSERT INTO kvstore (key, value, size, created_at, updated_at, expires_at)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, datetime('now', ?))
			ON CONFLICT(key) DO UPDATE SET
				value=excluded.value, size=excluded.size, updated_at=CURRENT_TIMESTAMP, expires_at=excluded.expires_at
		`, write.Key, write.Value, len(write.Value), expiresAt)
		if err != nil {
			return err
		}
	}
	return nil
}

func writeCommitState(ctx context.Context, tx *sql.Tx, track string, batch publicationCommitRequest) error {
	stateExpiry := time.Now().Add(publicationStateTTL)
	shortest := batch.Writes[0].TTL
	for _, write := range batch.Writes[1:] {
		if write.TTL < shortest {
			shortest = write.TTL
		}
	}
	if candidate := time.Now().Add(time.Duration(shortest) * time.Second); candidate.Before(stateExpiry) {
		stateExpiry = candidate
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO plugin_publication_state
			(track_key, scope, revision, snapshot_digest, complete, expires_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(track_key) DO UPDATE SET
			scope=excluded.scope, revision=excluded.revision, snapshot_digest=excluded.snapshot_digest,
			complete=excluded.complete, expires_at=excluded.expires_at
	`, track, batch.Scope, batch.Revision, batch.SnapshotDigest, batch.Complete, stateExpiry.UTC().Format("2006-01-02 15:04:05"))
	return err
}

func currentGenerationTx(ctx context.Context, tx *sql.Tx) (string, error) {
	var generation string
	err := tx.QueryRowContext(ctx, `SELECT generation FROM plugin_publication_generation WHERE id = 1`).Scan(&generation)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return generation, err
}

func storageUsedTx(ctx context.Context, tx *sql.Tx) (int64, error) {
	var used int64
	err := tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(size),0) FROM kvstore WHERE `+notExpiredFilter).Scan(&used)
	return used, err
}
