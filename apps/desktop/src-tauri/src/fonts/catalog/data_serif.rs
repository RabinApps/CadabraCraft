//! Serif text faces of the font catalog.
use super::{Family, RemoteFile};

pub const SERIF: &[Family] = &[
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
];
