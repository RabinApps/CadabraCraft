//! Display and poetry faces of the font catalog.
use super::{Family, RemoteFile};

pub const DISPLAY: &[Family] = &[
    Family {
        id: "im-fell-english",
        family: "IM Fell English",
        styles: &["Regular", "Italic"],
        files: &[
            file!("IMFeENrm28P.ttf", "imfellenglish/IMFeENrm28P.ttf", 194992, "fe9705bbde51af802719246d4608d08d37bde956ab99d9a590da996a5221a24c"),
            file!("IMFeENit28P.ttf", "imfellenglish/IMFeENit28P.ttf", 202368, "47cd75dce54b1f2e0831359d22d5e688f519d68ae45706b664fd310fd0e3ccf7"),
        ],
        licence: file!("OFL.txt", "imfellenglish/OFL.txt", 4452, "2a3ca501fc4d5efcad9798531e3e06962b1e20c60e464f6cbd6c17630112c773"),
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
        licence: file!("OFL.txt", "dmserifdisplay/OFL.txt", 4605, "a3e5cdd67d4571dd0a24fcc968de0efde7ae97ef752daf0906e4767619dd7231"),
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
        licence: file!("OFL.txt", "abrilfatface/OFL.txt", 4415, "aba8997e16b1e3888c6e855ba883c70d96bd4375bff8cb9c7ce0f097200f74b8"),
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
        licence: file!("OFL.txt", "cormorantinfant/OFL.txt", 4387, "60700d351cac4650c51f3f9db318d2a420f8b45052dba2715eb5fec41f0f6956"),
    },
    Family {
        id: "oswald",
        family: "Oswald",
        styles: &["Variable weight"],
        files: &[file!("Oswald-VF.ttf", "oswald/Oswald%5Bwght%5D.ttf", 172088, "5b38c246e255a12f5712d640d56bcced0472466fc68983d2d0410ec0457c2817")],
        licence: file!("OFL.txt", "oswald/OFL.txt", 4483, "0fd731a904b729a4e02eaf5e8ebd06783edd9abe400e8882760160230675b652"),
    },
    Family {
        id: "quicksand",
        family: "Quicksand",
        styles: &["Variable weight"],
        files: &[file!("Quicksand-VF.ttf", "quicksand/Quicksand%5Bwght%5D.ttf", 124824, "39c9b64223561f56aaff6062a6f04063c4fc86809ad6768722c06614d977e1cc")],
        licence: file!("OFL.txt", "quicksand/OFL.txt", 4445, "14d28541780d90f6577bb7abcc6f005bf6969614294e75c82abb8758a696ad46"),
    },
];
