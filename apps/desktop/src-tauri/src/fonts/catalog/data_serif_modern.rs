//! More serif text faces of the font catalog.
use super::{Family, RemoteFile};

pub const SERIF_MODERN: &[Family] = &[
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
];
