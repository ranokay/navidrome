package metrics

import (
	"context"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
)

func TestLyricsResolutionMetrics(t *testing.T) {
	instance := &metrics{}
	instance.RecordLyricsResolution(context.Background(), "sidecar", "found", 12)

	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatal(err)
	}

	var foundCount, foundLatency bool
	for _, family := range families {
		switch family.GetName() {
		case "lyrics_resolution_count":
			foundCount = true
		case "lyrics_resolution_latency":
			foundLatency = true
			if len(family.Metric) == 0 || family.Metric[0].Summary == nil {
				t.Fatal("lyrics latency metric is not a summary")
			}
			quantiles := family.Metric[0].Summary.Quantile
			want := map[float64]bool{0.5: false, 0.9: false, 0.95: false, 0.99: false}
			for _, quantile := range quantiles {
				if _, ok := want[quantile.GetQuantile()]; ok {
					want[quantile.GetQuantile()] = true
				}
			}
			for quantile, present := range want {
				if !present {
					t.Errorf("missing quantile %.2f", quantile)
				}
			}
		}
	}

	if !foundCount || !foundLatency {
		t.Fatalf("metrics missing: count=%t latency=%t", foundCount, foundLatency)
	}
}
