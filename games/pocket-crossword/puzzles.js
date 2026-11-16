// Pocket Crossword puzzles, written by hand. Each puzzle is five rows of five squares ('#' is a black
// square) and one clue per answer. The game works out the numbering from the rows.
window.POCKET_CROSSWORD_PUZZLES = [
    {
        rows: ['BOARD', 'ERROR', 'ABOVE', 'TIMES', 'STARS'],
        clues: {
            BOARD: 'Chess is played on one', ERROR: 'Slip-up', ABOVE: 'Higher than', TIMES: 'Multiplied by', STARS: 'Night sky twinklers',
            BEATS: 'Wins against', ORBIT: 'Circle the Earth, as the moon does', AROMA: 'Pleasant smell from the kitchen', ROVER: 'Robot car that explores Mars', DRESS: 'One-piece outfit with a skirt'
        }
    },
    {
        rows: ['#HIDE', 'TIDAL', 'OPENS', 'SPACE', 'SOLE#'],
        clues: {
            HIDE: 'Stay out of sight', TIDAL: '___ wave (huge ocean swell)', OPENS: 'Unlocks for business', SPACE: 'Where astronauts work', SOLE: 'Bottom of a shoe',
            TOSS: 'Throw lightly', HIPPO: 'Hefty river animal, for short', IDEAL: 'Perfect', DANCE: 'Waltz or tango', ELSE: 'Anything ___? (waiter\'s question)'
        }
    },
    {
        rows: ['#ITS#', 'TREND', 'HONOR', 'ENTRY', '#SHE#'],
        clues: {
            ITS: 'Belonging to it', TREND: 'The latest fashion', HONOR: 'Great respect', ENTRY: 'Way in', SHE: 'That woman or girl',
            THE: 'Most used word in English', IRONS: 'Presses the wrinkles out of', TENTH: 'Coming right after ninth', SNORE: 'Breathe noisily while asleep', DRY: 'Not wet'
        }
    },
    {
        rows: ['##PRO', 'SALAD', 'AWARD', 'LANES', 'EYE##'],
        clues: {
            PRO: 'Expert, for short', SALAD: 'Bowl of lettuce and veggies', AWARD: 'Prize or trophy', LANES: 'Bowling alley paths', EYE: 'Organ you see with',
            SALE: 'Event with marked-down prices', AWAY: 'Not at home', PLANE: 'It lands on a runway', RARE: 'Hard to find', ODDS: 'Chances of something happening'
        }
    },
    {
        rows: ['##NUT', '#DOSE', 'WOVEN', 'OVER#', 'EEL##'],
        clues: {
            NUT: 'Almond or cashew', DOSE: 'Measured amount of medicine', WOVEN: 'Made on a loom', OVER: 'Finished', EEL: 'Snake-like fish',
            WOE: 'Great sadness', DOVE: 'White bird that stands for peace', NOVEL: 'Long book of fiction', USER: 'Person with a login name', TEN: 'Number of fingers'
        }
    },
    {
        rows: ['VAST#', 'ALLOW', 'STAKE', 'EATEN', '#RENT'],
        clues: {
            VAST: 'Huge', ALLOW: 'Permit', STAKE: 'Pointed post that holds a tent down', EATEN: 'All gone from the plate', RENT: 'Monthly payment for an apartment',
            VASE: 'Holder for flowers', ALTAR: 'Raised table used in a ceremony', SLATE: 'Gray roofing rock', TOKEN: 'Coin for an arcade machine', WENT: 'Headed out; left'
        }
    },
    {
        rows: ['SAD##', 'PLAID', 'ASIDE', 'NOSES', '##YAK'],
        clues: {
            SAD: 'Unhappy', PLAID: 'Crisscross pattern on a flannel shirt', ASIDE: 'Step ___ (move out of the way)', NOSES: 'They sit in the middle of faces', YAK: 'Shaggy ox of the Himalayas',
            SPAN: 'Reach across, as a bridge does', ALSO: 'Too; as well', DAISY: 'White flower with a yellow center', IDEA: 'Light bulb moment', DESK: 'Table for homework'
        }
    },
    {
        rows: ['ATE##', 'WRAP#', 'EAGLE', '#PEEL', '##RAM'],
        clues: {
            ATE: 'Had dinner', WRAP: 'Cover a gift in paper', EAGLE: 'Large bird of prey with sharp eyes', PEEL: 'Banana skin', RAM: 'Male sheep',
            AWE: 'Feeling of wonder', TRAP: 'Device for catching a mouse', EAGER: 'Keen and excited', PLEA: 'Earnest request', ELM: 'Tall shade tree'
        }
    },
    {
        rows: ['#INCH', '#MULE', 'RADAR', 'EGGS#', 'DEEP#'],
        clues: {
            INCH: 'One twelfth of a foot', MULE: 'Stubborn animal, part horse and part donkey', RADAR: 'It tracks planes with radio waves', EGGS: 'They come by the dozen in a carton', DEEP: 'Far down; not shallow',
            RED: 'Color of a stop sign', IMAGE: 'Picture', NUDGE: 'Gentle push with an elbow', CLASP: 'Fastener on a necklace', HER: 'Belonging to that girl'
        }
    },
    {
        rows: ['USHER', 'N#U#H', 'TUMMY', 'I#I#M', 'LODGE'],
        clues: {
            USHER: 'Person who shows you to your seat', TUMMY: 'Belly, to a kid', LODGE: 'Cabin for skiers',
            UNTIL: 'Up to the time that', HUMID: 'Damp and sticky, as summer air', RHYME: 'What cat and hat do'
        }
    },
    {
        rows: ['STRAP', 'THOSE', 'AROSE', 'REFER', 'TESTS'],
        clues: {
            STRAP: 'Band that holds a watch on your wrist', THOSE: 'The ones over there', AROSE: 'Got out of bed', REFER: 'Mention or point toward', TESTS: 'Quizzes and exams',
            START: 'Begin', THREE: 'Number of sides on a triangle', ROOFS: 'House tops', ASSET: 'Useful thing to have; a plus', PEERS: 'Classmates of the same age'
        }
    },
    {
        rows: ['#LEAP', 'CELLO', 'RAVEN', 'EVERY', 'WEST#'],
        clues: {
            LEAP: 'Big jump', CELLO: 'Large string instrument played sitting down', RAVEN: 'Big black bird', EVERY: 'Each and ___ one', WEST: 'Where the sun sets',
            CREW: 'Team on a ship', LEAVE: 'Go away', ELVES: 'Small pointy-eared folk in fairy tales', ALERT: 'Wide awake and watchful', PONY: 'Small horse'
        }
    },
    {
        rows: ['#KIT#', 'ANGER', 'RELAY', 'CLOSE', '#TOE#'],
        clues: {
            KIT: 'First aid ___', ANGER: 'Feeling of being very mad', RELAY: 'Race where runners pass a baton', CLOSE: 'Shut', TOE: 'One of ten on your feet',
            ARC: 'Curved line, part of a circle', KNELT: 'Got down on both knees', IGLOO: 'Dome house built of snow blocks', TEASE: 'Make fun of playfully', RYE: 'Grain used in dark bread'
        }
    },
    {
        rows: ['##HUB', 'SCARE', 'ALIGN', 'WIRED', 'SPY##'],
        clues: {
            HUB: 'Center of a wheel', SCARE: 'Frighten', ALIGN: 'Line up straight', WIRED: 'Connected with cables', SPY: 'Secret agent',
            SAWS: 'Tools that cut wood', CLIP: 'Paper ___ (little metal fastener)', HAIRY: 'Covered in fur', URGE: 'Strong wish to do something', BEND: 'Curve in the road'
        }
    },
    {
        rows: ['##MET', '#FEAR', 'DIRTY', 'IRIS#', 'GET##'],
        clues: {
            MET: 'Got introduced to', FEAR: 'Feeling of being scared', DIRTY: 'Needing a wash', IRIS: 'Colored part of the eye', GET: 'Receive',
            DIG: 'Use a shovel', FIRE: 'Flames', MERIT: 'Earn; deserve', EATS: 'Has a meal', TRY: 'Make an attempt'
        }
    },
    {
        rows: ['CRAB#', 'LIMIT', 'APPLE', 'WELLS', '#NEST'],
        clues: {
            CRAB: 'Sideways walker on the beach', LIMIT: 'Speed ___ (number on a road sign)', APPLE: 'Fruit in many a pie', WELLS: 'Deep holes for drawing water', NEST: 'Bird\'s home',
            CLAW: 'Sharp nail on a cat\'s paw', RIPEN: 'Turn from green to ready to eat', AMPLE: 'More than enough', BILLS: 'Paper money', TEST: 'School exam'
        }
    },
    {
        rows: ['ASH##', 'COULD', 'HUMOR', 'ERASE', '##NEW'],
        clues: {
            ASH: 'Gray powder left by a fire', COULD: 'Was able to', HUMOR: 'Sense of ___ (what makes you laugh)', ERASE: 'Rub out pencil marks', NEW: 'Not old',
            ACHE: 'Dull pain', SOUR: 'Tasting like a lemon', HUMAN: 'Person', LOSE: 'Fail to win', DREW: 'Made a picture with a pencil'
        }
    },
    {
        rows: ['HOT##', 'IRON#', 'PATIO', '#LAND', '##LED'],
        clues: {
            HOT: 'Like soup straight off the stove', IRON: 'Metal that rusts', PATIO: 'Paved spot for backyard chairs', LAND: 'Touch down, as a plane', LED: 'Went first; showed the way',
            HIP: 'Joint below the waist', ORAL: 'Spoken, not written', TOTAL: 'Sum of all the numbers', NINE: 'Three times three', ODD: 'Like 1, 3 and 5'
        }
    },
    {
        rows: ['#DRAW', '#ROPE', 'COURT', 'ONTO#', 'BEEN#'],
        clues: {
            DRAW: 'Sketch', ROPE: 'Thick cord for tying or climbing', COURT: 'Where tennis is played', ONTO: 'The cat jumped ___ the bed', BEEN: 'Where have you ___?',
            COB: 'Corn on the ___', DRONE: 'Small flying machine with a camera', ROUTE: 'Path a bus follows', APRON: 'Cook\'s cover-up', WET: 'Soaked'
        }
    },
    {
        rows: ['#PEST', 'GRACE', 'RISEN', 'AMEND', 'BELT#'],
        clues: {
            PEST: 'Annoying bug or person', GRACE: 'Smooth elegance in movement', RISEN: 'Gone up, like bread dough', AMEND: 'Change, as a law', BELT: 'It holds up your pants',
            GRAB: 'Snatch', PRIME: 'Like the numbers 2, 3, 5 and 7', EASEL: 'Painter\'s stand', SCENT: 'Smell', TEND: 'Look after, as a garden'
        }
    },
    {
        rows: ['#HUM#', 'POSES', 'AMUSE', 'LEASE', '#SLY#'],
        clues: {
            HUM: 'Sing with your lips closed', POSES: 'Stands still for a photo', AMUSE: 'Entertain; make smile', LEASE: 'Rental agreement', SLY: 'Sneaky, like a fox',
            PAL: 'Buddy', HOMES: 'Houses', USUAL: 'Normal; typical', MESSY: 'Not tidy', SEE: 'Use your eyes'
        }
    },
    {
        rows: ['##VOW', 'SHINE', 'NEVER', 'ARISE', 'POD##'],
        clues: {
            VOW: 'Solemn promise', SHINE: 'Glow brightly', NEVER: 'Not ever', ARISE: 'Come up; get up', POD: 'Peas grow in one',
            SNAP: 'Sound made with finger and thumb', HERO: 'Brave person who saves the day', VIVID: 'Bright and full of color', ONES: 'Place value just right of the tens', WERE: 'Past tense of "are"'
        }
    },
    {
        rows: ['##OLD', '#TREE', 'URBAN', 'RUIN#', 'NET##'],
        clues: {
            OLD: 'Not young', TREE: 'Oak or maple', URBAN: 'Having to do with a city', RUIN: 'Spoil completely', NET: 'Mesh behind a soccer goal',
            URN: 'Large decorative vase', TRUE: 'Not false', ORBIT: 'Path of a planet around the sun', LEAN: 'Tilt to one side', DEN: 'Bear\'s home'
        }
    },
    {
        rows: ['SENT#', 'TRIAL', 'ARENA', 'ROCKS', '#REST'],
        clues: {
            SENT: 'Mailed', TRIAL: 'Courtroom event with a judge', ARENA: 'Stadium for sports or concerts', ROCKS: 'Stones', REST: 'Take a break',
            STAR: 'Twinkling light in the night sky', ERROR: 'Mistake', NIECE: 'Your brother\'s or sister\'s daughter', TANKS: 'Glass homes for pet fish', LAST: 'Final'
        }
    },
    {
        rows: ['WED##', 'EARS#', 'BROOK', '#NODE', '##PAY'],
        clues: {
            WED: 'Marry', EARS: 'You hear with them', BROOK: 'Small stream', NODE: 'Point where lines meet in a network', PAY: 'Hand over money',
            WEB: 'Spider\'s trap', EARN: 'Make money by working', DROOP: 'Sag, like a thirsty plant', SODA: 'Fizzy drink', KEY: 'It opens a lock'
        }
    },
    {
        rows: ['UPSET', 'N#Q#A', 'DRUMS', 'I#A#T', 'DODGE'],
        clues: {
            UPSET: 'Unhappy and bothered', DRUMS: 'Instruments you hit with sticks', DODGE: 'Duck out of the way',
            UNDID: 'Opened back up, as a knot', SQUAD: 'Small team', TASTE: 'Sense that tells sweet from sour'
        }
    },
    {
        rows: ['BRASS', 'EARTH', 'STORE', 'TIMID', 'SOAPS'],
        clues: {
            BRASS: 'Shiny yellow metal of trumpets', EARTH: 'Our planet', STORE: 'Shop', TIMID: 'Shy and easily scared', SOAPS: 'Bars for washing hands',
            BESTS: 'Outdoes; gets the better of', RATIO: 'Comparison like 3 to 1', AROMA: 'Smell of fresh bread, say', STRIP: 'Long narrow piece, as of paper', SHEDS: 'Backyard huts for tools'
        }
    },
    {
        rows: ['#CLUB', 'SHONE', 'WOODS', 'ASSET', 'PEER#'],
        clues: {
            CLUB: 'Golf stick', SHONE: 'Gave off light', WOODS: 'Small forest', ASSET: 'Something valuable to own', PEER: 'Look closely',
            SWAP: 'Trade one for another', CHOSE: 'Picked', LOOSE: 'Not tight', UNDER: 'Beneath', BEST: 'Number one'
        }
    },
    {
        rows: ['#DIP#', 'AISLE', 'NASAL', 'TRUNK', '#YES#'],
        clues: {
            DIP: 'Sauce for chips', AISLE: 'Walkway between rows of seats', NASAL: 'Having to do with the nose', TRUNK: 'Elephant\'s long nose', YES: 'Opposite of no',
            ANT: 'Tiny picnic visitor', DIARY: 'Private daily journal', ISSUE: 'One edition of a magazine', PLANS: 'Maps out ahead of time', ELK: 'Large deer with big antlers'
        }
    },
    {
        rows: ['##SPA', 'ARMOR', 'REALM', 'EARLY', 'ART##'],
        clues: {
            SPA: 'Place for a massage and a soak', ARMOR: 'Knight\'s metal suit', REALM: 'Kingdom', EARLY: 'Ahead of time', ART: 'Paintings and sculptures',
            AREA: 'Length times width', REAR: 'Back end', SMART: 'Clever', POLL: 'Survey of opinions', ARMY: 'Large force of soldiers'
        }
    },
    {
        rows: ['#DART', 'MOVIE', 'OZONE', 'REIGN', 'ENDS#'],
        clues: {
            DART: 'Pointed thing thrown at a round board', MOVIE: 'Film', OZONE: 'Protective layer high in the sky', REIGN: 'Rule as king or queen', ENDS: 'Finishes',
            MORE: 'Opposite of less', DOZEN: 'Twelve', AVOID: 'Stay away from', RINGS: 'Saturn is famous for them', TEEN: 'Person aged 13 to 19'
        }
    },
    {
        rows: ['#GEL#', 'WIELD', 'ARRAY', 'SLIME', '#SEA#'],
        clues: {
            GEL: 'Hair styling goo', WIELD: 'Hold and use, as a sword', ARRAY: 'Impressive display or arrangement', SLIME: 'Gooey trail left by a snail', SEA: 'Salty body of water',
            WAS: 'Used to be', GIRLS: 'Boys and ___', EERIE: 'Spooky and strange', LLAMA: 'Woolly pack animal of the Andes', DYE: 'Change the color of, as fabric'
        }
    }
];
