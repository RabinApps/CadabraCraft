//! Why a `.docx` could not be imported. The codes are the `ImportErrorCode` values of `packages/import-docx`, so the
//! UI shows the same sentence whichever importer failed.
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportErrorCode {
    InvalidZip,
    TooManyEntries,
    ArchiveTooLarge,
    MissingDocument,
    InvalidXml,
    /// An XML part has more elements, attributes or text than the importer will build a tree for.
    TooManyNodes,
}

impl ImportErrorCode {
    /// The kebab-case code the TypeScript side matches on.
    pub fn as_str(self) -> &'static str {
        match self {
            ImportErrorCode::InvalidZip => "invalid-zip",
            ImportErrorCode::TooManyEntries => "too-many-entries",
            ImportErrorCode::ArchiveTooLarge => "archive-too-large",
            ImportErrorCode::MissingDocument => "missing-document",
            ImportErrorCode::InvalidXml => "invalid-xml",
            ImportErrorCode::TooManyNodes => "too-many-nodes",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImportError {
    pub code: ImportErrorCode,
    /// English detail for logs and tests; the UI shows its own translated sentence for the code.
    pub message: String,
}

impl ImportError {
    pub fn new(code: ImportErrorCode, message: impl Into<String>) -> ImportError {
        ImportError { code, message: message.into() }
    }
}

impl fmt::Display for ImportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ImportError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_match_the_typescript_names() {
        let all = [
            (ImportErrorCode::InvalidZip, "invalid-zip"),
            (ImportErrorCode::TooManyEntries, "too-many-entries"),
            (ImportErrorCode::ArchiveTooLarge, "archive-too-large"),
            (ImportErrorCode::MissingDocument, "missing-document"),
            (ImportErrorCode::InvalidXml, "invalid-xml"),
            (ImportErrorCode::TooManyNodes, "too-many-nodes"),
        ];
        for (c, s) in all {
            assert_eq!(c.as_str(), s);
        }
        assert_eq!(ImportError::new(ImportErrorCode::InvalidZip, "boom").to_string(), "boom");
    }
}
