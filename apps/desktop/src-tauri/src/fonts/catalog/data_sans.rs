//! Sans-serif faces of the font catalog.
use super::{Family, RemoteFile};

pub const SANS: &[Family] = &[
    Family {
        id: "open-sans",
        family: "Open Sans",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!("OpenSans-VF.ttf", "opensans/OpenSans%5Bwdth%2Cwght%5D.ttf", 532636, "36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878"),
            file!(
                "OpenSans-Italic-VF.ttf",
                "opensans/OpenSans-Italic%5Bwdth%2Cwght%5D.ttf",
                583992,
                "fe269381e992f32e135801740998544d6235061e37c93ec067ad2be3edd5b17b"
            ),
        ],
        licence: file!("OFL.txt", "opensans/OFL.txt", 4389, "fbbbcfef55318de350562559b671360de6d597112ecc5c73881b05092db89602"),
    },
    Family {
        id: "lato",
        family: "Lato",
        styles: &["Regular", "Italic", "Bold", "Bold Italic"],
        files: &[
            file!("Lato-Regular.ttf", "lato/Lato-Regular.ttf", 656568, "d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251"),
            file!("Lato-Italic.ttf", "lato/Lato-Italic.ttf", 722900, "e399c44efe1387100531d26c7e4800c5d12251b890d6654a3098c7c679cb1786"),
            file!("Lato-Bold.ttf", "lato/Lato-Bold.ttf", 656544, "8a0aace75d33794eece4b28187bfc1df0bbd2888b5d8a56e01788c8d65d16be1"),
            file!("Lato-BoldItalic.ttf", "lato/Lato-BoldItalic.ttf", 698364, "62c1b7f0d2e74b45960154c3520efc337b553db0961bfdc950d5618334596cc8"),
        ],
        licence: file!("OFL.txt", "lato/OFL.txt", 4407, "74ba064d03f1f1c4a952da936c3eb71866c34404916734de3cae73b34357e59e"),
    },
    Family {
        id: "source-sans-3",
        family: "Source Sans 3",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!("SourceSans3-VF.ttf", "sourcesans3/SourceSans3%5Bwght%5D.ttf", 646340, "042fe2cc0b933e328410d7acbd0aa6a1873dca5aef81875f4bc214b08825c7b9"),
            file!(
                "SourceSans3-Italic-VF.ttf",
                "sourcesans3/SourceSans3-Italic%5Bwght%5D.ttf",
                395372,
                "39e3ab05ccd7cb94907c31005bb5bec1d5432f0b096a2b782976e217a540eb6c"
            ),
        ],
        licence: file!("OFL.txt", "sourcesans3/OFL.txt", 4579, "09746787287a289323b0ec3cff4d1a4a801331b82b7207c1e186f5d26619a392"),
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
        licence: file!("OFL.txt", "nunitosans/OFL.txt", 4393, "efbb0c9e864cef973982d9a17567e6be5c3d1759695574586f3f18c7ecca064b"),
    },
    Family {
        id: "work-sans",
        family: "Work Sans",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!("WorkSans-VF.ttf", "worksans/WorkSans%5Bwght%5D.ttf", 361072, "f50f61f2ba738e239442d40bf1069adb195c224b6a5a73a581fc2f3ed62a9f63"),
            file!(
                "WorkSans-Italic-VF.ttf",
                "worksans/WorkSans-Italic%5Bwght%5D.ttf",
                336756,
                "0a9f935ea490d3477fc97e40248f356c29bce11a1973939056c4316b122341ec"
            ),
        ],
        licence: file!("OFL.txt", "worksans/OFL.txt", 4396, "749aca05078664ce682dce1b1b10096ac397cb088c1a6df4e1bb56f0092a9272"),
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
        licence: file!("OFL.txt", "librefranklin/OFL.txt", 4495, "2710268527181a27b8e938617551bae29e714e6525247be6679bf897a9942a60"),
    },
    Family {
        id: "fira-sans",
        family: "Fira Sans",
        styles: &["Regular", "Italic", "Bold", "Bold Italic"],
        files: &[
            file!("FiraSans-Regular.ttf", "firasans/FiraSans-Regular.ttf", 456996, "c29556a2719bf613ef3d5e070e40d903a8965d9c081beca1375dc1e6e0f93c23"),
            file!("FiraSans-Italic.ttf", "firasans/FiraSans-Italic.ttf", 472396, "a4204f9a8029c1c55daa5385ac95936f74abea3e232770f1fb2862a19d1dfa13"),
            file!("FiraSans-Bold.ttf", "firasans/FiraSans-Bold.ttf", 489720, "a4d8e149ecdd4874a0726eb0af894488b3b31c423d6b0017c8f415ed1b795b45"),
            file!("FiraSans-BoldItalic.ttf", "firasans/FiraSans-BoldItalic.ttf", 506864, "1b96c16db9819bcaa9d588068bb397bb6e977c4874965d3d50d789a1943757eb"),
        ],
        licence: file!("OFL.txt", "firasans/OFL.txt", 4370, "8f24842e9174beda18a556c2ae7d54f5dc444340c19a3a9ef77e23bca366adbd"),
    },
    Family {
        id: "pt-sans",
        family: "PT Sans",
        styles: &["Regular", "Italic", "Bold", "Bold Italic"],
        files: &[
            file!("PT_Sans-Web-Regular.ttf", "ptsans/PT_Sans-Web-Regular.ttf", 442960, "9cc831490532009bae2b3ce0d39c62adfc889060beb421593bfd9d2396d0f10a"),
            file!("PT_Sans-Web-Italic.ttf", "ptsans/PT_Sans-Web-Italic.ttf", 436452, "5a90fe2d0cd798700935240580bdcc12c0ffc9102c0c7163b3418e13bc21debd"),
            file!("PT_Sans-Web-Bold.ttf", "ptsans/PT_Sans-Web-Bold.ttf", 470240, "3128bd5ecf01816e59a23d54c57a7a6b14615b07db53ff277c77376010265b05"),
            file!(
                "PT_Sans-Web-BoldItalic.ttf",
                "ptsans/PT_Sans-Web-BoldItalic.ttf",
                375204,
                "81ac221cdd02bccfa679c74adb122478e9d092e65a722e31ca11469961483785"
            ),
        ],
        licence: file!("OFL.txt", "ptsans/OFL.txt", 4425, "2758cf7a872827f39661cf8cc24188113c030447aefb5ca7145993650076ca8c"),
    },
    Family {
        id: "montserrat",
        family: "Montserrat",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!("Montserrat-VF.ttf", "montserrat/Montserrat%5Bwght%5D.ttf", 744936, "0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7"),
            file!(
                "Montserrat-Italic-VF.ttf",
                "montserrat/Montserrat-Italic%5Bwght%5D.ttf",
                762376,
                "51607f316bc020e59f03cbf51543eecffbea501c0b31d73e5b82927c5cca442c"
            ),
        ],
        licence: file!("OFL.txt", "montserrat/OFL.txt", 4400, "8b7141c03fa4f8d44e6345d5d4931709290f0f67875e452e95ac1fd3a027802e"),
    },
    Family {
        id: "raleway",
        family: "Raleway",
        styles: &["Regular, variable weight", "Italic, variable weight"],
        files: &[
            file!("Raleway-VF.ttf", "raleway/Raleway%5Bwght%5D.ttf", 312352, "8bbcc3eb8275c388f4bcd998832f8a4b943eadbaf6a595205312774b5951aefb"),
            file!("Raleway-Italic-VF.ttf", "raleway/Raleway-Italic%5Bwght%5D.ttf", 318476, "96629caf2202183fab46c70237055a7d67e6a5400b85413d45a77ed6f2a0770c"),
        ],
        licence: file!("OFL.txt", "raleway/OFL.txt", 4497, "7e946cf1171784d1015279e7dc35f827957a6b5d1f1f659ae0c98e5f5e37ed9b"),
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
        licence: file!("OFL.txt", "ibmplexsans/OFL.txt", 4456, "7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da"),
    },
];
