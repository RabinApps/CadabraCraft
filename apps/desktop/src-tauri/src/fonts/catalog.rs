//! The catalog of downloadable font families: SIL Open Font Licence families from the `google/fonts` repository, each
//! file pinned to one commit (never a branch) with its size and sha256, plus the family's licence text.
//!
//! Pinned to google/fonts commit 9862abc066c9b83bf84c3e8ed1fc2d8d48f9bbf0 (committed 2026-10-28, fetched and hashed
//! 2026-10-28). To update: pick a new commit, re-fetch every file once, and replace the commit, sizes and hashes together.
//! Static TTF files are used where the repository has them; otherwise the variable TTF (Typst reads both, never woff2).
//! A variable font's file name here ends in `-VF` (the upstream names have brackets); the URL keeps the upstream name.
use serde::Serialize;
use std::fs;
use std::path::Path;

pub struct RemoteFile {
    /// Name inside the family's folder (`fonts/<id>/<name>`).
    pub name: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

pub struct Family {
    pub id: &'static str,
    pub family: &'static str,
    /// One label per font file, in file order.
    pub styles: &'static [&'static str],
    pub files: &'static [RemoteFile],
    /// The OFL text. Downloaded with the fonts and kept next to them.
    pub licence: RemoteFile,
}

/// A file of the `google/fonts` repo at the pinned commit; `$path` is already percent-encoded.
macro_rules! file {
    ($name:literal, $path:literal, $size:literal, $sha:literal) => {
        RemoteFile { name: $name, url: concat!("https://raw.githubusercontent.com/google/fonts/9862abc066c9b83bf84c3e8ed1fc2d8d48f9bbf0/ofl/", $path), size: $size, sha256: $sha }
    };
}

pub const LICENCE: &str = "OFL-1.1";

pub const FAMILIES: &[Family] = &[
    // Serif text faces
    Family {
        id: "lora",
        family: "Lora",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "Lora-VF.ttf",
                "lora/Lora%5Bwght%5D.ttf",
                212196,
                "822a6621ccbe8d97d20ac88c1c41f5615c9c2c202eaa75f272cd452aac6475a7"
            ),
            file!(
                "Lora-Italic-VF.ttf",
                "lora/Lora-Italic%5Bwght%5D.ttf",
                221232,
                "22d8d8854b53807aa664ca34f2031a9ed57a1d0dea296b8b96cdd3aad937a2b3"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "lora/OFL.txt",
            4423,
            "1d9a970809ac804b582a6ce7f0ebc4e7fefcbfd7ff6299cad35ee656a21be716"
        ),
    },
    Family {
        id: "merriweather",
        family: "Merriweather",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "Merriweather-VF.ttf",
                "merriweather/Merriweather%5Bopsz%2Cwdth%2Cwght%5D.ttf",
                4628080,
                "d0ed0e359e396af7ad05e73dffd11a3a4c326ea0d0283c56bd9361cb2cc86a96"
            ),
            file!(
                "Merriweather-Italic-VF.ttf",
                "merriweather/Merriweather-Italic%5Bopsz%2Cwdth%2Cwght%5D.ttf",
                4591168,
                "f68a8f4989258679e4fbaf50aa42400132b5373c2d9d2514ba82ef6e85947a0b"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "merriweather/OFL.txt",
            4438,
            "715bd349bfa6116f99e351e1548321dcfa25b91df65502d22ca8d624557697d2"
        ),
    },
    Family {
        id: "crimson-pro",
        family: "Crimson Pro",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "CrimsonPro-VF.ttf",
                "crimsonpro/CrimsonPro%5Bwght%5D.ttf",
                246324,
                "16aa9fb7300a93637da51fac03a071b2ff08b6bbf65f99c794c25f040b58af6a"
            ),
            file!(
                "CrimsonPro-Italic-VF.ttf",
                "crimsonpro/CrimsonPro-Italic%5Bwght%5D.ttf",
                253176,
                "a74dc11dcf2fbb1452064e42395a40a907ca630b49cff86012223785e52b2559"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "crimsonpro/OFL.txt",
            4393,
            "1820869bd5baa1c2d88fa87c89eea532cf9442d841008acab720654b7f82823d"
        ),
    },
    Family {
        id: "crimson-text",
        family: "Crimson Text",
        styles: &["Regular", "Italic", "Bold", "Bold Italic"],
        files: &[
            file!(
                "CrimsonText-Regular.ttf",
                "crimsontext/CrimsonText-Regular.ttf",
                107200,
                "48e6c5d5ad1d01599d374ecb817e15890d1feb3b8a3a88e527d44c90389e1f06"
            ),
            file!(
                "CrimsonText-Italic.ttf",
                "crimsontext/CrimsonText-Italic.ttf",
                110216,
                "4ed1699ac7c64e8b3d33f6bb8323c3d7206b0d7bacb9ee2d65c697e6014d29de"
            ),
            file!(
                "CrimsonText-Bold.ttf",
                "crimsontext/CrimsonText-Bold.ttf",
                112796,
                "a3a0765fc5e8d0b49b540a23aefe0184887dd79f06a0bdf4db7035cea6befa93"
            ),
            file!(
                "CrimsonText-BoldItalic.ttf",
                "crimsontext/CrimsonText-BoldItalic.ttf",
                115112,
                "467013e913e46304760461c46661c994b2aa1769e3fbd31371026300315181b4"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "crimsontext/OFL.txt",
            4393,
            "50fd67cddc097377a5c871e8452b778bc5aedfa3480a705cb27c5e3a078218df"
        ),
    },
    Family {
        id: "eb-garamond",
        family: "EB Garamond",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "EBGaramond-VF.ttf",
                "ebgaramond/EBGaramond%5Bwght%5D.ttf",
                851176,
                "ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027"
            ),
            file!(
                "EBGaramond-Italic-VF.ttf",
                "ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf",
                754468,
                "bba2c4499c93c9612b90b9825d32b07da52fce2fe57562a1eb6b833553f93c4e"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "ebgaramond/OFL.txt",
            4398,
            "0985066662eb755ed3683ae5482a81a9195b49ce3f7e165cc2388b3dbece7dd7"
        ),
    },
    Family {
        id: "libre-baskerville",
        family: "Libre Baskerville",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "LibreBaskerville-VF.ttf",
                "librebaskerville/LibreBaskerville%5Bwght%5D.ttf",
                171900,
                "05a95421961341c5b2556285e8415df9db27dab4f4abe22b446b3c6a8b916c5d"
            ),
            file!(
                "LibreBaskerville-Italic-VF.ttf",
                "librebaskerville/LibreBaskerville-Italic%5Bwght%5D.ttf",
                167456,
                "223959683dc73ec4437bd61fabaa4b3f22209e22855ffd3aee36ba61a5116e97"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "librebaskerville/OFL.txt",
            4542,
            "3624eddd4c8f8a908130a417ae7cd089c9da69899c4e0ca1a5217d0a6fae16fd"
        ),
    },
    Family {
        id: "source-serif-4",
        family: "Source Serif 4",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "SourceSerif4-VF.ttf",
                "sourceserif4/SourceSerif4%5Bopsz%2Cwght%5D.ttf",
                1209508,
                "97b2d4da6e3cb494b5a1e66ae176914d852ccabef49e0c02c0df25f3e39aca0b"
            ),
            file!(
                "SourceSerif4-Italic-VF.ttf",
                "sourceserif4/SourceSerif4-Italic%5Bopsz%2Cwght%5D.ttf",
                855432,
                "15fbc7e4679489a501998c3669272637a6646388ef7e4bd77eebb5bf967a1f42"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "sourceserif4/OFL.txt",
            4400,
            "5f94c3fd3a23131a417ab5a0c8452de57e70c3cfb9f604d88241f7065ebf9fd9"
        ),
    },
    Family {
        id: "literata",
        family: "Literata",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "Literata-VF.ttf",
                "literata/Literata%5Bopsz%2Cwght%5D.ttf",
                955132,
                "b41138c9373112f32abb589cc22e8674b06ed4048b0c513be922bdd26f274440"
            ),
            file!(
                "Literata-Italic-VF.ttf",
                "literata/Literata-Italic%5Bopsz%2Cwght%5D.ttf",
                902728,
                "d483dfaeba9cbf4ce71d32a52ee65df82f7e35b15fff8d1011cdb242d1fcd465"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "literata/OFL.txt",
            4389,
            "8742963604cd89dc81437811a850018fc03b2bfad686d7422c8235967c87614e"
        ),
    },
    Family {
        id: "cormorant-garamond",
        family: "Cormorant Garamond",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "CormorantGaramond-VF.ttf",
                "cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf",
                1195560,
                "b20b7d9626dd956b2c5e558692ad328b1f19e3275e2782db4fa07670d83f35e0"
            ),
            file!(
                "CormorantGaramond-Italic-VF.ttf",
                "cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf",
                715644,
                "0f48ea6abb2084537854f7174c470991a463b13036309e3b50a81511611c530d"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "cormorantgaramond/OFL.txt",
            4387,
            "60700d351cac4650c51f3f9db318d2a420f8b45052dba2715eb5fec41f0f6956"
        ),
    },
    Family {
        id: "pt-serif",
        family: "PT Serif",
        styles: &["Regular", "Italic", "Bold", "Bold Italic"],
        files: &[
            file!(
                "PT_Serif-Web-Regular.ttf",
                "ptserif/PT_Serif-Web-Regular.ttf",
                359048,
                "a4951fade06ff8f09b7673aa81ffb65a8cd409e24d3289a6dc670bc4dda2557a"
            ),
            file!(
                "PT_Serif-Web-Italic.ttf",
                "ptserif/PT_Serif-Web-Italic.ttf",
                375356,
                "f57e95ff9dc85691a3b2e193f2028db36f6663939a46c0fc4f286d618b80b7ce"
            ),
            file!(
                "PT_Serif-Web-Bold.ttf",
                "ptserif/PT_Serif-Web-Bold.ttf",
                339996,
                "038ba7336bd7ea14f12ad155bed51a4345cac5153275d521dec3ba04021c526e"
            ),
            file!(
                "PT_Serif-Web-BoldItalic.ttf",
                "ptserif/PT_Serif-Web-BoldItalic.ttf",
                337580,
                "f003788ba08981eb0988b3557a6f224a53dab49c20e283e8b74d5af3c466f8be"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "ptserif/OFL.txt",
            4434,
            "ddf311c28ddf5a5ad9747649837346b67bed9d356789c3072bb27dbce49e514d"
        ),
    },
    Family {
        id: "spectral",
        family: "Spectral",
        styles: &["Regular", "Italic", "Bold", "Bold Italic"],
        files: &[
            file!(
                "Spectral-Regular.ttf",
                "spectral/Spectral-Regular.ttf",
                261088,
                "c89021dc20720c8d0dcf40b0b2f6e00c13665fa8041717f581396f51b8c78f5d"
            ),
            file!(
                "Spectral-Italic.ttf",
                "spectral/Spectral-Italic.ttf",
                270468,
                "7ec97244259db4008c4b1224c7914e5371c797c0044af9d85c2d761ba0e5f787"
            ),
            file!(
                "Spectral-Bold.ttf",
                "spectral/Spectral-Bold.ttf",
                273220,
                "70ddb1ec6ae3b0b8d0c79231f670de786978f19baeba2130757526e407aebf9b"
            ),
            file!(
                "Spectral-BoldItalic.ttf",
                "spectral/Spectral-BoldItalic.ttf",
                284356,
                "709fa4f2da9be216fd52125db2d6caa4f90150f48de1a453c9ecf91117ab49b6"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "spectral/OFL.txt",
            4392,
            "501d6ceca8e552630fe3aa9442b9a818565680a1a2f79f3fb8c13d6f309a9e98"
        ),
    },
    Family {
        id: "playfair-display",
        family: "Playfair Display",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "PlayfairDisplay-VF.ttf",
                "playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf",
                300724,
                "c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6"
            ),
            file!(
                "PlayfairDisplay-Italic-VF.ttf",
                "playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf",
                278688,
                "a5e26dc5e2e77fb2803a0bf02fd4f81ee136ec8dea863ccdb0c59a263b21378b"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "playfairdisplay/OFL.txt",
            4449,
            "566be814f8e96e93dfa16101331557eb6b5467e9e03f627c0910fe93ca12300e"
        ),
    },
    Family {
        id: "bitter",
        family: "Bitter",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "Bitter-VF.ttf",
                "bitter/Bitter%5Bwght%5D.ttf",
                328636,
                "ef2b9a711fb02f1e5823b34da1b7450e0fc76793b7d733a8b41006e24916d4a7"
            ),
            file!(
                "Bitter-Italic-VF.ttf",
                "bitter/Bitter-Italic%5Bwght%5D.ttf",
                317652,
                "5e6e0af503171c9d7b4be7a22c16f474d7a638cf83a80051d825bcc58d664bc3"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "bitter/OFL.txt",
            4424,
            "152a1e283e23b42c4940da4c72f2f5bebaa17969cb77c76d7af05903846006f1"
        ),
    },
    Family {
        id: "vollkorn",
        family: "Vollkorn",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "Vollkorn-VF.ttf",
                "vollkorn/Vollkorn%5Bwght%5D.ttf",
                577864,
                "4ebef434f76f80286204840354a84db79a0dc3c87deeeb791e015b70b2ade49d"
            ),
            file!(
                "Vollkorn-Italic-VF.ttf",
                "vollkorn/Vollkorn-Italic%5Bwght%5D.ttf",
                441264,
                "cd947ae49b5d46e812d8d09434fbe8ec452286cd5557ef6a762a3562e2c8d300"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "vollkorn/OFL.txt",
            4489,
            "53f9c99fa3d47f7d632a42ee7bab4a834a60a744f6026d676c3a223cef2b2ef3"
        ),
    },
    Family {
        id: "alegreya",
        family: "Alegreya",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "Alegreya-VF.ttf",
                "alegreya/Alegreya%5Bwght%5D.ttf",
                425288,
                "ba5564634b93a8f8ba57b48cd4f1ae7417d2b4656fbac779028679b00de3cf12"
            ),
            file!(
                "Alegreya-Italic-VF.ttf",
                "alegreya/Alegreya-Italic%5Bwght%5D.ttf",
                425852,
                "fa915eec76227935dc5fb678953c94b71287c360928013cfdb441dfe52f5a391"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "alegreya/OFL.txt",
            4395,
            "f6f60d5d4cf4f4b1fc4e41353c897a2f5a16e6396c0cd8fa8bdfd2f4586a9a68"
        ),
    },
    Family {
        id: "cardo",
        family: "Cardo",
        styles: &["Regular", "Italic", "Bold"],
        files: &[
            file!(
                "Cardo-Regular.ttf",
                "cardo/Cardo-Regular.ttf",
                400468,
                "bcb81f376f1c3892c7026dabf2beafbd1a7ee8ae95d132ee7d4ff7d7c3988261"
            ),
            file!(
                "Cardo-Italic.ttf",
                "cardo/Cardo-Italic.ttf",
                262388,
                "52c51cfde3a827dd9428511c4a968699952b8a917c5f0e97be782cbfa1880f9c"
            ),
            file!(
                "Cardo-Bold.ttf",
                "cardo/Cardo-Bold.ttf",
                348320,
                "6c9383b1471936ee83b08b67bf79f0ed92bee3d5e8363ec3ba21309d5a272e36"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "cardo/OFL.txt",
            4372,
            "8e28b778b6e1a7ff9ca72f4dee2d53120aa2856dc1bfd0be44307e365b0e45bb"
        ),
    },
    Family {
        id: "ibm-plex-serif",
        family: "IBM Plex Serif",
        styles: &["Regular", "Italic", "Bold", "Bold Italic"],
        files: &[
            file!(
                "IBMPlexSerif-Regular.ttf",
                "ibmplexserif/IBMPlexSerif-Regular.ttf",
                163068,
                "e882efa9c41949a528ac2369079ec5ef050c1c996bbd0bacce3c3326d44cf80d"
            ),
            file!(
                "IBMPlexSerif-Italic.ttf",
                "ibmplexserif/IBMPlexSerif-Italic.ttf",
                173004,
                "4b75b38be4673527231f49c48818d090c913d5042dd5c747b525bf6185d29ecb"
            ),
            file!(
                "IBMPlexSerif-Bold.ttf",
                "ibmplexserif/IBMPlexSerif-Bold.ttf",
                163800,
                "534c02c295999dd86e770457ece1d43db0de9256dd98bf741426f63ae904209e"
            ),
            file!(
                "IBMPlexSerif-BoldItalic.ttf",
                "ibmplexserif/IBMPlexSerif-BoldItalic.ttf",
                173032,
                "2a32b76ac19c1942bf5942dbbd2a1566e5f1ae9833e421ebcf36d3522715e153"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "ibmplexserif/OFL.txt",
            4456,
            "7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da"
        ),
    },
    // Sans-serif
    Family {
        id: "open-sans",
        family: "Open Sans",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "OpenSans-VF.ttf",
                "opensans/OpenSans%5Bwdth%2Cwght%5D.ttf",
                532636,
                "36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878"
            ),
            file!(
                "OpenSans-Italic-VF.ttf",
                "opensans/OpenSans-Italic%5Bwdth%2Cwght%5D.ttf",
                583992,
                "fe269381e992f32e135801740998544d6235061e37c93ec067ad2be3edd5b17b"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "opensans/OFL.txt",
            4389,
            "fbbbcfef55318de350562559b671360de6d597112ecc5c73881b05092db89602"
        ),
    },
    Family {
        id: "lato",
        family: "Lato",
        styles: &["Regular", "Italic", "Bold", "Bold Italic"],
        files: &[
            file!(
                "Lato-Regular.ttf",
                "lato/Lato-Regular.ttf",
                656568,
                "d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251"
            ),
            file!(
                "Lato-Italic.ttf",
                "lato/Lato-Italic.ttf",
                722900,
                "e399c44efe1387100531d26c7e4800c5d12251b890d6654a3098c7c679cb1786"
            ),
            file!(
                "Lato-Bold.ttf",
                "lato/Lato-Bold.ttf",
                656544,
                "8a0aace75d33794eece4b28187bfc1df0bbd2888b5d8a56e01788c8d65d16be1"
            ),
            file!(
                "Lato-BoldItalic.ttf",
                "lato/Lato-BoldItalic.ttf",
                698364,
                "62c1b7f0d2e74b45960154c3520efc337b553db0961bfdc950d5618334596cc8"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "lato/OFL.txt",
            4407,
            "74ba064d03f1f1c4a952da936c3eb71866c34404916734de3cae73b34357e59e"
        ),
    },
    Family {
        id: "source-sans-3",
        family: "Source Sans 3",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "SourceSans3-VF.ttf",
                "sourcesans3/SourceSans3%5Bwght%5D.ttf",
                646340,
                "042fe2cc0b933e328410d7acbd0aa6a1873dca5aef81875f4bc214b08825c7b9"
            ),
            file!(
                "SourceSans3-Italic-VF.ttf",
                "sourcesans3/SourceSans3-Italic%5Bwght%5D.ttf",
                395372,
                "39e3ab05ccd7cb94907c31005bb5bec1d5432f0b096a2b782976e217a540eb6c"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "sourcesans3/OFL.txt",
            4579,
            "09746787287a289323b0ec3cff4d1a4a801331b82b7207c1e186f5d26619a392"
        ),
    },
    Family {
        id: "nunito-sans",
        family: "Nunito Sans",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "NunitoSans-VF.ttf",
                "nunitosans/NunitoSans%5BYTLC%2Copsz%2Cwdth%2Cwght%5D.ttf",
                571240,
                "f934d7142fb4784bf828da485b7dcbd90c0c80d514e9d49a5da0ed3a1ae2491d"
            ),
            file!(
                "NunitoSans-Italic-VF.ttf",
                "nunitosans/NunitoSans-Italic%5BYTLC%2Copsz%2Cwdth%2Cwght%5D.ttf",
                558412,
                "d9d5db18f3c11221a4fbb553cbc709391c1179964c7eaa4466ef43c78aa4492f"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "nunitosans/OFL.txt",
            4393,
            "efbb0c9e864cef973982d9a17567e6be5c3d1759695574586f3f18c7ecca064b"
        ),
    },
    Family {
        id: "work-sans",
        family: "Work Sans",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "WorkSans-VF.ttf",
                "worksans/WorkSans%5Bwght%5D.ttf",
                361072,
                "f50f61f2ba738e239442d40bf1069adb195c224b6a5a73a581fc2f3ed62a9f63"
            ),
            file!(
                "WorkSans-Italic-VF.ttf",
                "worksans/WorkSans-Italic%5Bwght%5D.ttf",
                336756,
                "0a9f935ea490d3477fc97e40248f356c29bce11a1973939056c4316b122341ec"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "worksans/OFL.txt",
            4396,
            "749aca05078664ce682dce1b1b10096ac397cb088c1a6df4e1bb56f0092a9272"
        ),
    },
    Family {
        id: "libre-franklin",
        family: "Libre Franklin",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "LibreFranklin-VF.ttf",
                "librefranklin/LibreFranklin%5Bwght%5D.ttf",
                187436,
                "2329f394b10ed1c71107df20fddc11e2bb1b68c1ecbb385f975b36fd64a971f8"
            ),
            file!(
                "LibreFranklin-Italic-VF.ttf",
                "librefranklin/LibreFranklin-Italic%5Bwght%5D.ttf",
                206092,
                "b8d2f40203bd4d90fe3e805953d9b79d62a6486db756d984b0d8ef4435b367ba"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "librefranklin/OFL.txt",
            4495,
            "2710268527181a27b8e938617551bae29e714e6525247be6679bf897a9942a60"
        ),
    },
    Family {
        id: "fira-sans",
        family: "Fira Sans",
        styles: &["Regular", "Italic", "Bold", "Bold Italic"],
        files: &[
            file!(
                "FiraSans-Regular.ttf",
                "firasans/FiraSans-Regular.ttf",
                456996,
                "c29556a2719bf613ef3d5e070e40d903a8965d9c081beca1375dc1e6e0f93c23"
            ),
            file!(
                "FiraSans-Italic.ttf",
                "firasans/FiraSans-Italic.ttf",
                472396,
                "a4204f9a8029c1c55daa5385ac95936f74abea3e232770f1fb2862a19d1dfa13"
            ),
            file!(
                "FiraSans-Bold.ttf",
                "firasans/FiraSans-Bold.ttf",
                489720,
                "a4d8e149ecdd4874a0726eb0af894488b3b31c423d6b0017c8f415ed1b795b45"
            ),
            file!(
                "FiraSans-BoldItalic.ttf",
                "firasans/FiraSans-BoldItalic.ttf",
                506864,
                "1b96c16db9819bcaa9d588068bb397bb6e977c4874965d3d50d789a1943757eb"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "firasans/OFL.txt",
            4370,
            "8f24842e9174beda18a556c2ae7d54f5dc444340c19a3a9ef77e23bca366adbd"
        ),
    },
    Family {
        id: "pt-sans",
        family: "PT Sans",
        styles: &["Regular", "Italic", "Bold", "Bold Italic"],
        files: &[
            file!(
                "PT_Sans-Web-Regular.ttf",
                "ptsans/PT_Sans-Web-Regular.ttf",
                442960,
                "9cc831490532009bae2b3ce0d39c62adfc889060beb421593bfd9d2396d0f10a"
            ),
            file!(
                "PT_Sans-Web-Italic.ttf",
                "ptsans/PT_Sans-Web-Italic.ttf",
                436452,
                "5a90fe2d0cd798700935240580bdcc12c0ffc9102c0c7163b3418e13bc21debd"
            ),
            file!(
                "PT_Sans-Web-Bold.ttf",
                "ptsans/PT_Sans-Web-Bold.ttf",
                470240,
                "3128bd5ecf01816e59a23d54c57a7a6b14615b07db53ff277c77376010265b05"
            ),
            file!(
                "PT_Sans-Web-BoldItalic.ttf",
                "ptsans/PT_Sans-Web-BoldItalic.ttf",
                375204,
                "81ac221cdd02bccfa679c74adb122478e9d092e65a722e31ca11469961483785"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "ptsans/OFL.txt",
            4425,
            "2758cf7a872827f39661cf8cc24188113c030447aefb5ca7145993650076ca8c"
        ),
    },
    Family {
        id: "montserrat",
        family: "Montserrat",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "Montserrat-VF.ttf",
                "montserrat/Montserrat%5Bwght%5D.ttf",
                744936,
                "0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7"
            ),
            file!(
                "Montserrat-Italic-VF.ttf",
                "montserrat/Montserrat-Italic%5Bwght%5D.ttf",
                762376,
                "51607f316bc020e59f03cbf51543eecffbea501c0b31d73e5b82927c5cca442c"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "montserrat/OFL.txt",
            4400,
            "8b7141c03fa4f8d44e6345d5d4931709290f0f67875e452e95ac1fd3a027802e"
        ),
    },
    Family {
        id: "raleway",
        family: "Raleway",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "Raleway-VF.ttf",
                "raleway/Raleway%5Bwght%5D.ttf",
                312352,
                "8bbcc3eb8275c388f4bcd998832f8a4b943eadbaf6a595205312774b5951aefb"
            ),
            file!(
                "Raleway-Italic-VF.ttf",
                "raleway/Raleway-Italic%5Bwght%5D.ttf",
                318476,
                "96629caf2202183fab46c70237055a7d67e6a5400b85413d45a77ed6f2a0770c"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "raleway/OFL.txt",
            4497,
            "7e946cf1171784d1015279e7dc35f827957a6b5d1f1f659ae0c98e5f5e37ed9b"
        ),
    },
    Family {
        id: "ibm-plex-sans",
        family: "IBM Plex Sans",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "IBMPlexSans-VF.ttf",
                "ibmplexsans/IBMPlexSans%5Bwdth%2Cwght%5D.ttf",
                537244,
                "3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3"
            ),
            file!(
                "IBMPlexSans-Italic-VF.ttf",
                "ibmplexsans/IBMPlexSans-Italic%5Bwdth%2Cwght%5D.ttf",
                599624,
                "0b94c5e981993764db32bf9c610ecc60cbd34ad77ec2f10ba03c64ab75124d8e"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "ibmplexsans/OFL.txt",
            4456,
            "7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da"
        ),
    },
    // Monospace
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
    // Display and poetry
    Family {
        id: "im-fell-english",
        family: "IM Fell English",
        styles: &["Regular", "Italic"],
        files: &[
            file!(
                "IMFeENrm28P.ttf",
                "imfellenglish/IMFeENrm28P.ttf",
                194992,
                "fe9705bbde51af802719246d4608d08d37bde956ab99d9a590da996a5221a24c"
            ),
            file!(
                "IMFeENit28P.ttf",
                "imfellenglish/IMFeENit28P.ttf",
                202368,
                "47cd75dce54b1f2e0831359d22d5e688f519d68ae45706b664fd310fd0e3ccf7"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "imfellenglish/OFL.txt",
            4452,
            "2a3ca501fc4d5efcad9798531e3e06962b1e20c60e464f6cbd6c17630112c773"
        ),
    },
    Family {
        id: "dm-serif-display",
        family: "DM Serif Display",
        styles: &["Regular", "Italic"],
        files: &[
            file!(
                "DMSerifDisplay-Regular.ttf",
                "dmserifdisplay/DMSerifDisplay-Regular.ttf",
                76580,
                "8cc3643535edf039aa5d95440a8542735e9197e4f4b8d9303e980fefbf5ab616"
            ),
            file!(
                "DMSerifDisplay-Italic.ttf",
                "dmserifdisplay/DMSerifDisplay-Italic.ttf",
                71208,
                "df74c0ac387baeaeb0fe4f2324e1668e6a3ed8c09cd9796fe162c71753e19e45"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "dmserifdisplay/OFL.txt",
            4605,
            "a3e5cdd67d4571dd0a24fcc968de0efde7ae97ef752daf0906e4767619dd7231"
        ),
    },
    Family {
        id: "abril-fatface",
        family: "Abril Fatface",
        styles: &["Regular"],
        files: &[file!(
            "AbrilFatface-Regular.ttf",
            "abrilfatface/AbrilFatface-Regular.ttf",
            67364,
            "5971d4a3758a922a9fedc7f6fb825a96341a2e718c45a4b2c9a6b417c8c4dbe9"
        )],
        licence: file!(
            "OFL.txt",
            "abrilfatface/OFL.txt",
            4415,
            "aba8997e16b1e3888c6e855ba883c70d96bd4375bff8cb9c7ce0f097200f74b8"
        ),
    },
    Family {
        id: "cormorant-infant",
        family: "Cormorant Infant",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!(
                "CormorantInfant-VF.ttf",
                "cormorantinfant/CormorantInfant%5Bwght%5D.ttf",
                1174156,
                "48c6efe07539c75d3108795467898706a9cd71ce876d461e45f58482156d7bf3"
            ),
            file!(
                "CormorantInfant-Italic-VF.ttf",
                "cormorantinfant/CormorantInfant-Italic%5Bwght%5D.ttf",
                717948,
                "d5f81edef82cf31c093d057709e1bfb42aa776aacf78651b14f9817c2decb251"
            ),
        ],
        licence: file!(
            "OFL.txt",
            "cormorantinfant/OFL.txt",
            4387,
            "60700d351cac4650c51f3f9db318d2a420f8b45052dba2715eb5fec41f0f6956"
        ),
    },
    Family {
        id: "oswald",
        family: "Oswald",
        styles: &["Variable weight"],
        files: &[file!(
            "Oswald-VF.ttf",
            "oswald/Oswald%5Bwght%5D.ttf",
            172088,
            "5b38c246e255a12f5712d640d56bcced0472466fc68983d2d0410ec0457c2817"
        )],
        licence: file!(
            "OFL.txt",
            "oswald/OFL.txt",
            4483,
            "0fd731a904b729a4e02eaf5e8ebd06783edd9abe400e8882760160230675b652"
        ),
    },
    Family {
        id: "quicksand",
        family: "Quicksand",
        styles: &["Variable weight"],
        files: &[file!(
            "Quicksand-VF.ttf",
            "quicksand/Quicksand%5Bwght%5D.ttf",
            124824,
            "39c9b64223561f56aaff6062a6f04063c4fc86809ad6768722c06614d977e1cc"
        )],
        licence: file!(
            "OFL.txt",
            "quicksand/OFL.txt",
            4445,
            "14d28541780d90f6577bb7abcc6f005bf6969614294e75c82abb8758a696ad46"
        ),
    },
];

impl Family {
    /// Download size: the fonts and the licence text.
    pub fn bytes(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum::<u64>() + self.licence.size
    }

    /// Every file (fonts and licence) is there with exactly the pinned size. A file only gets its final name after its
    /// hash matched.
    pub fn installed(&self, root: &Path) -> bool {
        let dir = root.join(self.id);
        self.files
            .iter()
            .chain(std::iter::once(&self.licence))
            .all(|f| fs::metadata(dir.join(f.name)).is_ok_and(|m| m.is_file() && m.len() == f.size))
    }
}

pub fn find_family(id: &str) -> Option<&'static Family> {
    FAMILIES.iter().find(|f| f.id == id)
}

/// Where a family's licence text lives, for the "Licence" link of the UI.
pub fn licence_url(f: &Family) -> &'static str {
    f.licence.url
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FontPackInfo {
    pub id: &'static str,
    pub family: &'static str,
    pub styles: &'static [&'static str],
    pub bytes: u64,
    pub installed: bool,
    pub licence: &'static str,
    pub licence_url: &'static str,
}

pub fn list_catalog(root: Option<&Path>) -> Vec<FontPackInfo> {
    FAMILIES
        .iter()
        .map(|f| FontPackInfo {
            id: f.id,
            family: f.family,
            styles: f.styles,
            bytes: f.bytes(),
            installed: root.is_some_and(|r| f.installed(r)),
            licence: LICENCE,
            licence_url: licence_url(f),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn all_files(f: &Family) -> impl Iterator<Item = &RemoteFile> {
        f.files.iter().chain(std::iter::once(&f.licence))
    }

    #[test]
    fn the_catalog_has_about_forty_families_with_unique_ids_and_family_names() {
        assert!(
            (35..=45).contains(&FAMILIES.len()),
            "{} families",
            FAMILIES.len()
        );
        assert_eq!(
            FAMILIES.iter().map(|f| f.id).collect::<HashSet<_>>().len(),
            FAMILIES.len()
        );
        assert_eq!(
            FAMILIES
                .iter()
                .map(|f| f.family)
                .collect::<HashSet<_>>()
                .len(),
            FAMILIES.len()
        );
        for f in FAMILIES {
            assert!(
                f.id.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
                "{}",
                f.id
            );
            assert!(
                !f.id.starts_with("imported"),
                "{} would collide with imported fonts",
                f.id
            );
            assert!(!f.family.trim().is_empty());
        }
    }

    #[test]
    fn every_file_is_pinned_to_a_40_hex_commit_over_https_with_a_size_and_a_hash() {
        let prefix = "https://raw.githubusercontent.com/google/fonts/";
        for f in FAMILIES {
            for file in all_files(f) {
                let rest = file
                    .url
                    .strip_prefix(prefix)
                    .unwrap_or_else(|| panic!("{}: {}", f.id, file.url));
                let (commit, path) = rest.split_once('/').unwrap();
                assert!(
                    commit.len() == 40
                        && commit
                            .bytes()
                            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
                    "{}: commit {commit}",
                    f.id
                );
                assert!(path.starts_with("ofl/"), "{}: {path}", f.id);
                assert!(
                    !file.url.contains(['[', ']', ' ', ',']),
                    "{}: unencoded url {}",
                    f.id,
                    file.url
                );
                assert!(file.size > 0, "{}", file.name);
                assert!(
                    file.sha256.len() == 64
                        && file
                            .sha256
                            .bytes()
                            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
                    "{}: {}",
                    f.id,
                    file.name
                );
            }
        }
        let commits: HashSet<_> = FAMILIES
            .iter()
            .flat_map(all_files)
            .map(|f| f.url[prefix.len()..prefix.len() + 40].to_string())
            .collect();
        assert_eq!(commits.len(), 1, "one commit for the whole catalog");
    }

    #[test]
    fn fonts_are_ttf_or_otf_files_with_safe_unique_names_and_a_style_each() {
        for f in FAMILIES {
            assert!(!f.files.is_empty());
            assert_eq!(
                f.styles.len(),
                f.files.len(),
                "{}: one style per file",
                f.id
            );
            let names: HashSet<_> = f.files.iter().map(|x| x.name).collect();
            assert_eq!(names.len(), f.files.len(), "{}: duplicate file names", f.id);
            for file in f.files {
                let lower = file.name.to_ascii_lowercase();
                assert!(
                    lower.ends_with(".ttf") || lower.ends_with(".otf"),
                    "{}: {}",
                    f.id,
                    file.name
                );
                assert!(
                    file.name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_')),
                    "{}",
                    file.name
                );
                assert!(
                    file.url.to_ascii_lowercase().ends_with(".ttf")
                        || file.url.to_ascii_lowercase().ends_with(".otf")
                );
            }
        }
    }

    #[test]
    fn every_family_ships_its_licence_text() {
        for f in FAMILIES {
            assert_eq!(f.licence.name, "OFL.txt", "{}", f.id);
            assert!(f.licence.url.ends_with("/OFL.txt"), "{}", f.id);
            assert!(
                (1_000..20_000).contains(&f.licence.size),
                "{}: {}",
                f.id,
                f.licence.size
            );
        }
        let info = list_catalog(None);
        assert!(info.iter().all(|i| i.licence == "OFL-1.1"
            && i.licence_url.ends_with("/OFL.txt")
            && !i.installed
            && i.bytes > 0));
    }

    #[test]
    fn the_catalog_covers_the_faces_authors_ask_for() {
        for id in [
            "lora",
            "merriweather",
            "crimson-pro",
            "eb-garamond",
            "libre-baskerville",
            "source-serif-4",
            "literata",
            "cormorant-garamond",
            "pt-serif",
            "spectral",
            "playfair-display",
            "open-sans",
            "lato",
            "source-sans-3",
            "nunito-sans",
            "work-sans",
            "source-code-pro",
        ] {
            assert!(find_family(id).is_some(), "{id}");
        }
        assert!(find_family("nope").is_none());
    }

    #[test]
    fn a_family_is_installed_only_when_every_file_has_its_pinned_size() {
        let f = find_family("cardo").unwrap();
        let root = tempfile::tempdir().unwrap();
        assert!(!f.installed(root.path()));
        let dir = root.path().join(f.id);
        fs::create_dir_all(&dir).unwrap();
        for file in all_files(f) {
            fs::write(dir.join(file.name), vec![0u8; file.size as usize]).unwrap();
        }
        assert!(f.installed(root.path()));
        let info = list_catalog(Some(root.path()));
        assert!(info.iter().find(|i| i.id == "cardo").unwrap().installed);
        assert!(!info.iter().find(|i| i.id == "lora").unwrap().installed);
        fs::write(dir.join(f.files[0].name), b"short").unwrap();
        assert!(!f.installed(root.path()));
    }

    #[test]
    fn the_info_serializes_with_the_camel_case_names_of_the_bridge() {
        let v = serde_json::to_value(&list_catalog(None)[0]).unwrap();
        for key in [
            "id",
            "family",
            "styles",
            "bytes",
            "installed",
            "licence",
            "licenceUrl",
        ] {
            assert!(v.get(key).is_some(), "{key}");
        }
    }

    /// Opt-in (CADABRA_NET_TESTS=1): the licence texts are small, so fetch them from the real server and check the pins.
    #[test]
    fn real_licence_files_match_their_pins() {
        if std::env::var("CADABRA_NET_TESTS").as_deref() != Ok("1") {
            return;
        }
        let client = crate::audio::download::build_client().unwrap();
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let dir = tempfile::tempdir().unwrap();
        for f in FAMILIES.iter().take(3) {
            let dest = dir.path().join(f.id).join(f.licence.name);
            tauri::async_runtime::block_on(crate::audio::download::download_file(
                &client,
                f.licence.url,
                f.licence.size,
                f.licence.sha256,
                &dest,
                &cancel,
                &mut |_| {},
            ))
            .unwrap();
        }
    }
}
