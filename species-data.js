window.SPECIES_DATA = {
  warmwater: [
    ["Bluegill","Lepomis macrochirus"],["Pumpkinseed","Lepomis gibbosus"],
    ["Largemouth Bass","Micropterus salmoides"],["Smallmouth Bass","Micropterus dolomieu"],
    ["Rock Bass","Ambloplites rupestris"],["Yellow Perch","Perca flavescens"],
    ["Walleye","Sander vitreus"],["Sauger","Sander canadensis"],
    ["Northern Pike","Esox lucius"],["Muskellunge","Esox masquinongy"],
    ["Black Crappie","Pomoxis nigromaculatus"],["White Crappie","Pomoxis annularis"],
    ["Channel Catfish","Ictalurus punctatus"],["Flathead Catfish","Pylodictis olivaris"],
    ["Brown Bullhead","Ameiurus nebulosus"],["Yellow Bullhead","Ameiurus natalis"],
    ["Black Bullhead","Ameiurus melas"],["Freshwater Drum","Aplodinotus grunniens"],
    ["White Bass","Morone chrysops"],["Bowfin","Amia calva"],
    ["Longnose Gar","Lepisosteus osseus"],["Spotted Gar","Lepisosteus oculatus"]
  ],
  greatlakes: [
    ["Lake Trout","Salvelinus namaycush"],["Coho Salmon","Oncorhynchus kisutch"],
    ["Chinook Salmon","Oncorhynchus tshawytscha"],["Rainbow Trout / Steelhead","Oncorhynchus mykiss"],
    ["Brown Trout","Salmo trutta"],["Brook Trout","Salvelinus fontinalis"],
    ["Bloater","Coregonus hoyi"],["Cisco / Lake Herring","Coregonus artedi"],
    ["Lake Whitefish","Coregonus clupeaformis"],["Alewife","Alosa pseudoharengus"],
    ["Gizzard Shad","Dorosoma cepedianum"],["Burbot","Lota lota"],
    ["Slimy Sculpin","Cottus cognatus"],["Mottled Sculpin","Cottus bairdii"]
  ],
  invasive: [
    ["Common Carp","Cyprinus carpio"],["Goldfish","Carassius auratus"],
    ["Grass Carp","Ctenopharyngodon idella"],["Silver Carp","Hypophthalmichthys molitrix"],
    ["Bighead Carp","Hypophthalmichthys nobilis"],["Black Carp","Mylopharyngodon piceus"],
    ["Round Goby","Neogobius melanostomus"],["Tubenose Goby","Proterorhinus semilunaris"],
    ["Rainbow Smelt","Osmerus mordax"],["Ruffe","Gymnocephalus cernua"],
    ["Tench","Tinca tinca"],["Rudd","Scardinius erythrophthalmus"]
  ],
  minnow: [
    ["Golden Shiner","Notemigonus crysoleucas"],["Common Shiner","Luxilus cornutus"],
    ["Bluntnose Minnow","Pimephales notatus"],["Fathead Minnow","Pimephales promelas"],
    ["Creek Chub","Semotilus atromaculatus"],["Emerald Shiner","Notropis atherinoides"],
    ["Spotfin Shiner","Cyprinella spiloptera"],["Logperch","Percina caprodes"],
    ["Johnny Darter","Etheostoma nigrum"],["Rainbow Darter","Etheostoma caeruleum"],
    ["Stonecat","Noturus flavus"],["Northern Hogsucker","Hypentelium nigricans"],
    ["White Sucker","Catostomus commersonii"],["Shorthead Redhorse","Moxostoma macrolepidotum"],
    ["Quillback","Carpiodes cyprinus"]
  ],
  other: [
    ["Unknown species",""],["Other (describe in notes)",""]
  ]
};

window.CAT_LABELS = {
  warmwater: "Warmwater", greatlakes: "Great Lakes", invasive: "Invasive",
  minnow: "Minnows & Darters", other: "Other"
};

// Survey sites (formerly "watersheds")
window.SURVEY_SITES = [
  "Shedd Aquarium", "Adler Planetarium", "Morgan Shoal",
  "Wolf Lake", "Montrose Beach", "Other"
];

// Trap IDs 26-01 .. 26-33 (change prefix per survey year as needed)
window.TRAP_IDS = Array.from({length: 33}, (_, i) => "26-" + String(i + 1).padStart(2, "0"));
