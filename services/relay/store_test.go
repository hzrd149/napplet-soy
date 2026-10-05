package main

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"fiatjaf.com/nostr"
)

func fixture(t *testing.T, key nostr.SecretKey, kind nostr.Kind, at nostr.Timestamp, tags nostr.Tags, content string) nostr.Event {
	t.Helper()
	e := nostr.Event{Kind: kind, CreatedAt: at, Tags: tags, Content: content}
	if err := e.Sign(key); err != nil {
		t.Fatal(err)
	}
	return e
}
func put(t *testing.T, s *eventStore, e nostr.Event) {
	t.Helper()
	var err error
	if e.Kind.IsRegular() {
		err = s.SaveEvent(e)
	} else {
		_, err = s.ReplaceEvent(e)
	}
	if err != nil {
		t.Fatal(err)
	}
}
func testStore(t *testing.T) *eventStore {
	t.Helper()
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}
func events(s *eventStore, f nostr.Filter) []nostr.Event {
	return slices.Collect(s.QueryEvents(f, 200))
}
func TestMetadataSearchAndFilters(t *testing.T) {
	s := testStore(t)
	a, b := nostr.Generate(), nostr.Generate()
	now := nostr.Now()
	wanted := fixture(t, a, 35129, now, nostr.Tags{{"d", "orbit"}, {"title", "Velvet lunar orbit"}, {"description", "A bouncing moon"}, {"t", "visuals"}}, "")
	put(t, s, wanted)
	put(t, s, fixture(t, b, 35129, now, nostr.Tags{{"d", "other"}, {"title", "Velvet lunar orbit"}, {"t", "visuals"}}, ""))
	put(t, s, fixture(t, a, 5129, now, nostr.Tags{{"title", "Velvet lunar orbit"}, {"t", "visuals"}}, ""))
	for _, search := range []string{"velvet", "bouncing moon", `"lunar orbit"`} {
		got := events(s, nostr.Filter{Search: search, Authors: []nostr.PubKey{wanted.PubKey}, Kinds: []nostr.Kind{35129}, Tags: nostr.TagMap{"t": {"visuals"}}, Since: now, Until: now})
		if len(got) != 1 || got[0].ID != wanted.ID {
			t.Fatalf("%q: got %v", search, got)
		}
	}
	for _, f := range []nostr.Filter{{Search: "velvet", Until: now - 1}, {Search: "velvet", Tags: nostr.TagMap{"t": {"games"}}}, {Search: `"orbit lunar"`}, {Search: "velvet", IDs: []nostr.ID{wanted.ID}, Authors: []nostr.PubKey{b.Public()}}} {
		if got := events(s, f); len(got) != 0 {
			t.Fatalf("unexpected search matches: %v", got)
		}
	}
	if got := events(s, nostr.Filter{IDs: []nostr.ID{wanted.ID}, Kinds: []nostr.Kind{1}}); len(got) != 0 {
		t.Fatal("ID lookup bypassed kind filter")
	}
}

func TestStandaloneContentAndCapabilityDiscovery(t *testing.T) {
	s := testStore(t)
	key := nostr.Generate()
	now := nostr.Now()
	for _, kind := range []nostr.Kind{35129, 15129, 5129} {
		tags := nostr.Tags{{"x", strings.Repeat("a", 64)}, {"z", "feed"}, {"i", "napplet:feed/open", "relays"}, {"R", "relay"}, {"R", "storage"}, {"O", "theme"}}
		if kind == 35129 {
			tags = append(tags, nostr.Tag{"d", "feed"})
		}
		wanted := fixture(t, key, kind, now, tags, "A floating constellation reader")
		put(t, s, wanted)
		for _, search := range []string{"", "constellation", `"floating constellation"`} {
			filter := nostr.Filter{Kinds: []nostr.Kind{kind}, Search: search, Tags: nostr.TagMap{"R": {"storage"}, "O": {"theme"}, "z": {"feed"}, "i": {"napplet:feed/open"}}}
			got := events(s, filter)
			if len(got) != 1 || got[0].ID != wanted.ID {
				t.Fatalf("kind %d search %q: standard discovery filters missed the manifest: %v", kind, search, got)
			}
		}
	}
	for _, tags := range []nostr.TagMap{{"R": {"theme"}}, {"O": {"relay"}}, {"z": {"profile"}}, {"i": {"relays"}}} {
		if got := events(s, nostr.Filter{Tags: tags}); len(got) != 0 {
			t.Fatalf("incorrect optional/required or intent parameter match: %v", got)
		}
	}
	if got := events(s, nostr.Filter{Tags: nostr.TagMap{"R": {"unavailable", "relay"}}}); len(got) != 3 {
		t.Fatal("standard multi-value #R must retain NIP-01 OR semantics")
	}
}
func TestSearchPaginatesAndOrders(t *testing.T) {
	s := testStore(t)
	key := nostr.Generate()
	now := nostr.Now()
	// More than a single Bleve page; the narrow author/topic/time predicate must not underfill.
	for i := 0; i < 130; i++ {
		put(t, s, fixture(t, key, 5129, now-nostr.Timestamp(i), nostr.Tags{{"title", "Pixel garden"}, {"t", "visuals"}}, fmt.Sprint(i)))
	}
	got := events(s, nostr.Filter{Search: "pixel", Kinds: []nostr.Kind{5129}, Tags: nostr.TagMap{"t": {"visuals"}}, Limit: 125})
	if len(got) != 125 {
		t.Fatalf("got %d events", len(got))
	}
	for i := 1; i < len(got); i++ {
		if got[i].CreatedAt > got[i-1].CreatedAt {
			t.Fatal("not newest first")
		}
	}
	got = events(s, nostr.Filter{Search: "pixel", Until: now - 120, Limit: 5})
	if len(got) != 5 || got[0].CreatedAt != now-120 {
		t.Fatal("filtered page underfilled")
	}
}
func TestReplacementDeletionAndExpiry(t *testing.T) {
	s := testStore(t)
	key := nostr.Generate()
	now := nostr.Now()
	old := fixture(t, key, 35129, now-2, nostr.Tags{{"d", "toy"}, {"title", "Old orbit"}}, "")
	newer := fixture(t, key, 35129, now-1, nostr.Tags{{"d", "toy"}, {"title", "New garden"}}, "")
	put(t, s, old)
	put(t, s, newer)
	s.ReplaceEvent(old)
	if len(events(s, nostr.Filter{Search: "orbit"})) != 0 {
		t.Fatal("replaced event remains searchable")
	}
	if got := events(s, nostr.Filter{Search: "garden"}); len(got) != 1 || got[0].ID != newer.ID {
		t.Fatal("replacement missing")
	}
	if err := s.DeleteEvent(newer.ID); err != nil {
		t.Fatal(err)
	}
	if len(events(s, nostr.Filter{Search: "garden"})) != 0 {
		t.Fatal("deleted event remains searchable")
	}
	put(t, s, fixture(t, key, 5129, now, nostr.Tags{{"expiration", fmt.Sprint(now - 1)}, {"title", "Expired pixel"}}, ""))
	if len(events(s, nostr.Filter{Search: "pixel"})) != 0 || len(events(s, nostr.Filter{})) != 0 {
		t.Fatal("expired event is visible")
	}
}
func TestSearchRebuildAfterInterruptedIndexWrite(t *testing.T) {
	dir := t.TempDir()
	s, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	e := fixture(t, nostr.Generate(), 35129, nostr.Now(), nostr.Tags{{"d", "recovery"}, {"title", "Recovered garden"}}, "")
	// Simulate termination after durable event storage and before the search update.
	if err = s.raw.SaveEvent(e); err != nil {
		t.Fatal(err)
	}
	s.Close()
	// A corrupt index is also disposable. No authoritative events may be removed.
	if err = os.WriteFile(filepath.Join(dir, "search.bleve", "index_meta.json"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	s, err = openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got := events(s, nostr.Filter{Search: `"recovered garden"`})
	if len(got) != 1 || got[0].ID != e.ID || !got[0].VerifySignature() {
		t.Fatal("durable signed event was not recovered")
	}
}

func TestDataDirectoryHasSingleOwner(t *testing.T) {
	dir := t.TempDir()
	first, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := openStore(dir); err == nil {
		second.Close()
		t.Fatal("two instances opened the same data directory")
	}
	first.Close()
	second, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	second.Close()
}
func TestDeletionMarkersSurviveRestartAndHideInterruptedDeletes(t *testing.T) {
	dir := t.TempDir()
	s, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	key := nostr.Generate()
	now := nostr.Now()
	e := fixture(t, key, 5129, now, nostr.Tags{{"title", "Pixel memory"}}, "")
	put(t, s, e)
	// Marker is durable, but the process dies before Khatru physically deletes e.
	marker := fixture(t, key, 5, now-1, nostr.Tags{{"e", e.ID.Hex()}}, "")
	put(t, s, marker)
	s.Close()
	s, err = openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if len(events(s, nostr.Filter{Search: "pixel"})) != 0 {
		t.Fatal("interrupted deletion was resurrected")
	}
	if err = s.SaveEvent(e); err == nil {
		t.Fatal("deleted event replay accepted")
	}
}
func TestExpiryCleanupAndLimitZero(t *testing.T) {
	s := testStore(t)
	key := nostr.Generate()
	now := nostr.Now()
	put(t, s, fixture(t, key, 5129, now, nostr.Tags{{"title", "Visible garden"}}, ""))
	old := fixture(t, key, 5129, now, nostr.Tags{{"title", "Expired garden"}, {"expiration", fmt.Sprint(now - 1)}}, "")
	put(t, s, old)
	if len(events(s, nostr.Filter{Search: "garden", LimitZero: true})) != 0 {
		t.Fatal("limit zero returned stored events")
	}
	if err := s.purgeExpired(); err != nil {
		t.Fatal(err)
	}
	if len(slices.Collect(s.raw.QueryEvents(nostr.Filter{IDs: []nostr.ID{old.ID}}, 1))) != 0 {
		t.Fatal("expired raw record was not removed")
	}
	if len(events(s, nostr.Filter{Search: "garden"})) != 1 {
		t.Fatal("expiry removed a live record")
	}
}
func TestEqualTimeReplacementWinner(t *testing.T) {
	s := testStore(t)
	key := nostr.Generate()
	now := nostr.Now()
	a := fixture(t, key, 35129, now, nostr.Tags{{"d", "tie"}, {"title", "Garden amber"}}, "")
	b := fixture(t, key, 35129, now, nostr.Tags{{"d", "tie"}, {"title", "Garden blue"}}, "")
	winner, loser := a, b
	if b.ID.Hex() < a.ID.Hex() {
		winner, loser = b, a
	}
	put(t, s, loser)
	put(t, s, winner)
	s.ReplaceEvent(loser)
	got := events(s, nostr.Filter{Search: "garden"})
	if len(got) != 1 || got[0].ID != winner.ID {
		t.Fatal("equal-time replacement did not keep lowest ID")
	}
}
