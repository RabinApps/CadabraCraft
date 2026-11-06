//! Link references: only a plain http or https address may reach the operating system's default browser. The webview
//! already normalizes what the author types, but the check is repeated here because a command trusts nothing it is sent.
use super::{ProjectError, Result};

/// Longest address kept, in characters (the same limit as `MAX_URL_CHARS` in `@cadabracraft/format`).
pub const MAX_URL_CHARS: usize = 2048;

/// The address when it is `http://` or `https://` (any letter case) followed by a host, with no whitespace or control
/// characters and at most `MAX_URL_CHARS` characters. Anything else (`javascript:`, `file:`, `mailto:`, a bare host) is refused.
pub fn checked_web_url(url: &str) -> Result<&str> {
    let refuse = || ProjectError::UnsupportedReference { name: url.chars().take(80).collect() };
    if url.chars().count() > MAX_URL_CHARS || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(refuse());
    }
    let lower = url.to_ascii_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://")).ok_or_else(refuse)?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or("");
    if host.is_empty() || host.starts_with(':') {
        return Err(refuse());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_web_addresses_pass() {
        for ok in [
            "https://example.org",
            "http://example.org/a?b=1#c",
            "HTTPS://Example.org/x",
            "https://user@example.org:8080/p",
            "http://[::1]:3000/",
            "https://例え.jp/",
        ] {
            assert_eq!(checked_web_url(ok).unwrap(), ok, "{ok}");
        }
    }

    #[test]
    fn anything_else_is_refused() {
        let long = format!("https://example.org/{}", "a".repeat(MAX_URL_CHARS));
        for bad in [
            "",
            "example.org",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "mailto:a@b.org",
            "data:text/html,x",
            "ftp://example.org/",
            "https://",
            "http:///path",
            "https://:80/",
            "https://exa mple.org",
            "https://example.org/\n",
            "https://example.org/\u{7}",
            "https://example.org/\u{a0}x",
            " https://example.org",
            &long,
        ] {
            assert!(matches!(checked_web_url(bad), Err(ProjectError::UnsupportedReference { .. })), "{bad:?}");
        }
    }

    #[test]
    fn the_limit_is_in_characters_and_the_error_names_a_short_prefix() {
        let at_limit = format!("https://example.org/{}", "é".repeat(MAX_URL_CHARS - "https://example.org/".len()));
        assert!(checked_web_url(&at_limit).is_ok());
        let Err(ProjectError::UnsupportedReference { name }) = checked_web_url(&format!("{at_limit}x")) else { panic!("expected a refusal") };
        assert_eq!(name.chars().count(), 80);
    }
}
