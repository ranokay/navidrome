package lyrics

import (
	"context"
	"sync"

	"github.com/navidrome/navidrome/model"
)

type detailedFlight struct {
	refresh bool
	done    chan struct{}
	result  model.LyricsResult
	err     error
}

// detailedCoordinator coalesces detailed lookups without retaining them. A
// normal caller arriving during refresh joins the refresh; a refresh arriving
// during a normal load waits for it and then starts exactly one refresh.
type detailedCoordinator struct {
	mu      sync.Mutex
	flights map[string]*detailedFlight
}

func newDetailedCoordinator() *detailedCoordinator {
	return &detailedCoordinator{flights: make(map[string]*detailedFlight)}
}

func (c *detailedCoordinator) do(ctx context.Context, key string, refresh bool, prepare func() error, loader func(context.Context) (model.LyricsResult, error)) (model.LyricsResult, error) {
	for {
		c.mu.Lock()
		flight := c.flights[key]
		if flight != nil {
			c.mu.Unlock()
			select {
			case <-ctx.Done():
				return model.LyricsResult{}, ctx.Err()
			case <-flight.done:
				if refresh && !flight.refresh {
					continue // sequential refresh after the normal load
				}
				if flight.err != nil {
					return model.LyricsResult{}, flight.err
				}
				return flight.result, nil
			}
		}
		flight = &detailedFlight{refresh: refresh, done: make(chan struct{})}
		c.flights[key] = flight
		c.mu.Unlock()
		if refresh && prepare != nil {
			if err := prepare(); err != nil {
				flight.err = err
				c.mu.Lock()
				delete(c.flights, key)
				c.mu.Unlock()
				close(flight.done)
				return model.LyricsResult{}, err
			}
		}

		go func() {
			loadCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), detailedLoadBudget)
			result, err := loader(loadCtx)
			cancel()
			flight.result, flight.err = result, err
			c.mu.Lock()
			delete(c.flights, key)
			c.mu.Unlock()
			close(flight.done)
		}()

		select {
		case <-ctx.Done():
			return model.LyricsResult{}, ctx.Err()
		case <-flight.done:
			if flight.err != nil {
				return model.LyricsResult{}, flight.err
			}
			return flight.result, nil
		}
	}
}
