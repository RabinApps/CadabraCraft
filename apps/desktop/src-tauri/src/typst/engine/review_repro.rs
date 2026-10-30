//! Repro for review finding 1: `skip_noise` ends a block comment at the first `*/`, Typst nests them.
use super::*;

#[test]
#[ignore = "repro for review finding 1"]
fn finding_1_nested_block_comment_hides_a_package_import() {
    // Real typst 0.15.1 reads this as ONE comment and then tries to download @preview/example (verified by hand).
    let src = "#import /* /* */ */ \"@preview/example:0.1.0\"\nhi\n";
    assert!(refuse_packages(src).is_err(), "refuse_packages let a package import through");
}

#[test]
fn finding_1_control_flat_comment_is_refused() {
    let src = "#import /* x */ \"@preview/example:0.1.0\"\nhi\n";
    assert!(refuse_packages(src).is_err());
}
