//! Repro for review finding 3: `MediaRoots::register` evicts `keys().next()`, an arbitrary entry.
use super::*;

fn fill(n: usize) -> (MediaRoots, Vec<String>) {
    let roots = MediaRoots::default();
    let tokens = (0..n).map(|i| roots.register(Path::new(&format!("/books/{i}")))).collect();
    (roots, tokens)
}

#[test]
#[ignore = "repro for review finding 3"]
fn finding_3_eviction_can_drop_the_most_recently_registered_token() {
    let trials = 20_000;
    let (mut hit_newest, mut hit_oldest) = (0, 0);
    for _ in 0..trials {
        let (roots, tokens) = fill(MAX_ROOTS); // fresh HashMap => fresh RandomState => fresh order
        let newest = tokens[MAX_ROOTS - 1].clone();
        let oldest = tokens[0].clone();
        let t65 = roots.register(Path::new("/books/overflow"));
        assert!(roots.root_of(&t65).is_some(), "the token just registered is never the evicted one (insert follows evict)");
        hit_newest += usize::from(roots.root_of(&newest).is_none());
        hit_oldest += usize::from(roots.root_of(&oldest).is_none());
    }
    eprintln!("evicted newest-before-overflow: {hit_newest}/{trials}; evicted oldest: {hit_oldest}/{trials} (uniform would be {})", trials / MAX_ROOTS);
    assert_eq!(hit_newest, 0, "the most recently registered token was evicted {hit_newest} times of {trials}");
}
