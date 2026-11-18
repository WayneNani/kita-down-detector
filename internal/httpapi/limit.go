package httpapi

import (
	"sync"
	"time"
)

// limiter zählt Anfragen pro Schlüssel in festen Zeitfenstern – nur im RAM.
type limiter struct {
	mu      sync.Mutex
	fenster time.Duration
	max     int
	start   time.Time
	zaehler map[string]int
}

func neuerLimiter(max int, fenster time.Duration) *limiter {
	return &limiter{fenster: fenster, max: max, zaehler: map[string]int{}}
}

func (l *limiter) erlaubt(schluessel string, jetzt time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if jetzt.Sub(l.start) >= l.fenster {
		l.start = jetzt
		clear(l.zaehler)
	}
	l.zaehler[schluessel]++
	return l.zaehler[schluessel] <= l.max
}
