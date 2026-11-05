//! Monospace faces of the font catalog.
use super::{Family, RemoteFile};

pub const MONO: &[Family] = &[
    Family {
        id: "source-code-pro",
        family: "Source Code Pro",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "SourceCodePro-VF.ttf",
                "sourcecodepro/SourceCodePro%5Bwght%5D.ttf",
                212340,
                "b400fc584e10aff25d0e775ce181b4fc1c5ea1b5dc37b81aeb2084375b945790"
            ),
            file!(
                "SourceCodePro-Italic-VF.ttf",
                "sourcecodepro/SourceCodePro-Italic%5Bwght%5D.ttf",
                174852,
                "6db77d25aa7b30eff449305b5c998e475694c74d398421127ea5a60f536413cd"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "sourcecodepro/OFL.txt",
            4622,
            "cb30d3086a8b3ce0b9e3690bf48d6620402b61160bc658076f95180ccd9e9dae"
        ),
    },
    Family {
        id: "ibm-plex-mono",
        family: "IBM Plex Mono",
        styles: &["Regular", "Italic", "Bold", "Bold Italic"],
        files: &[
            file!(
                "IBMPlexMono-Regular.ttf",
                "ibmplexmono/IBMPlexMono-Regular.ttf",
                135580,
                "6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46"
            ),
            file!(
                "IBMPlexMono-Italic.ttf",
                "ibmplexmono/IBMPlexMono-Italic.ttf",
                143920,
                "3362fc791b0652193328b862c1c5f23a789bc7288b1617fa63302f88689a2a34"
            ),
            file!(
                "IBMPlexMono-Bold.ttf",
                "ibmplexmono/IBMPlexMono-Bold.ttf",
                137784,
                "ac27abd6450a64dd94467580a02fe6235156d5b92f2926ebbc8e7489df64e0be"
            ),
            file!(
                "IBMPlexMono-BoldItalic.ttf",
                "ibmplexmono/IBMPlexMono-BoldItalic.ttf",
                144512,
                "af4e05a761e98c1adf064c48a6352c9bec1a6ad70982cd2a544149323391f98e"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "ibmplexmono/OFL.txt",
            4456,
            "7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da"
        ),
    },
    Family {
        id: "jetbrains-mono",
        family: "JetBrains Mono",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "JetBrainsMono-VF.ttf",
                "jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
                187208,
                "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda"
            ),
            file!(
                "JetBrainsMono-Italic-VF.ttf",
                "jetbrainsmono/JetBrainsMono-Italic%5Bwght%5D.ttf",
                191556,
                "85ae2a5cd3f56baf1ce1c21a851322c58e3d8fbe8e8ad4a4d090a820dd7fe558"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "jetbrainsmono/OFL.txt",
            4399,
            "b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d"
        ),
    },
    Family {
        id: "roboto-mono",
        family: "Roboto Mono",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "RobotoMono-VF.ttf",
                "robotomono/RobotoMono%5Bwght%5D.ttf",
                183700,
                "66a80e79d17e4c7cabd162e2916578a4cc08fd19eef6e2a643305eae9c567b2b"
            ),
            file!(
                "RobotoMono-Italic-VF.ttf",
                "robotomono/RobotoMono-Italic%5Bwght%5D.ttf",
                196792,
                "49ac343bb7b070071e53f0a8a501d68d140ed98ebd0a43b6b8fb96cf22f09ff7"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "robotomono/OFL.txt",
            4395,
            "50ab8dd54680d3473f649c9db86fece88434d097c7834475c1c72d2f8c429215"
        ),
    },
    Family {
        id: "inconsolata",
        family: "Inconsolata",
        styles: &["Variable weight"],
        files: &[file!(
            "Inconsolata-VF.ttf",
            "inconsolata/Inconsolata%5Bwdth%2Cwght%5D.ttf",
            347180,
            "23ded25b447074d00659392bf9b1123d89df55cb07b0ad9bfef3366d199b5fcb"
        )],
        licence: file!(
            "OFL.txt",
            "inconsolata/OFL.txt",
            4350,
            "29bd0cfd0fb2a45f9b057c834a057724bae1f63b525a8ac83d3e7525706d9f80"
        ),
    },
    Family {
        id: "pt-mono",
        family: "PT Mono",
        styles: &["Regular"],
        files: &[file!(
            "PTM55FT.ttf",
            "ptmono/PTM55FT.ttf",
            185912,
            "cbe732b3b8fd211fd986ebdfc9b870ddeca4faab0bb5425fc509b37f9b4ac804"
        )],
        licence: file!(
            "OFL.txt",
            "ptmono/OFL.txt",
            4448,
            "511125dc85198375795fdbc109d088654d3b7f9dbd3ccb7bf93d844aef0b153c"
        ),
    },
];
