// Starting catalog, written to the database the first time the site runs.
// After that, staff edit everything from the admin.

export const DEFAULT_SERVICES = [
  { id: "s1", cat: "Start", name: "Starter locs", price: 3500, dur: "3–4 hrs", desc: "Comb coils or two-strand twists on natural hair, sized to how you want your locs to look.", care: "First retwist in 4 weeks" },
  { id: "s2", cat: "Start", name: "Instant locs", price: 8000, dur: "5–7 hrs", desc: "Fully formed locs in one session using the crochet method. No budding stage.", care: "Low-maintenance from day one" },
  { id: "s3", cat: "Start", name: "Microlocs installation", price: 18000, dur: "2 sessions", desc: "Small, uniform locs set with a grid pattern. We do a consultation first.", care: "Interlock every 6–8 wks" },
  { id: "s4", cat: "Maintain", name: "Retwist & style", price: 1500, dur: "2 hrs", desc: "Palm-roll retwist of new growth with a light gel, finished with a simple style.", care: "Every 4–6 wks" },
  { id: "s5", cat: "Maintain", name: "Interlocking maintenance", price: 2000, dur: "2–3 hrs", desc: "Tool-pulled roots that hold longer than a retwist. Good for active lifestyles.", care: "Every 6–8 wks" },
  { id: "s6", cat: "Maintain", name: "Loc detox", price: 1200, dur: "1.5 hrs", desc: "Apple cider vinegar and baking soda soak to lift build-up and lint, then a deep rinse.", care: "Every 3 months" },
  { id: "s7", cat: "Repair", name: "Loc repair & reattachment", price: 800, dur: "1 hr", desc: "Fixes thinning points and reattaches broken locs. Price is per 10 locs.", care: "As needed" },
  { id: "s8", cat: "Repair", name: "Loc extensions", price: 12000, dur: "6–8 hrs", desc: "Human-hair extensions added to your locs for length or fullness. Price covers 50 locs.", care: "Retwist every 4–6 wks" },
  { id: "s9", cat: "Style", name: "Barrel twists or petals", price: 1000, dur: "1.5 hrs", desc: "Barrel rolls, petal buns or a loc updo for events. Includes finishing with gold cuffs.", care: "Lasts 1–2 wks" },
  { id: "s10", cat: "Style", name: "Loc bob & colour", price: 4500, dur: "3 hrs", desc: "Shaping cut plus semi-permanent colour on the ends or all over.", care: "Colour refresh in 8 wks" },
];

export const DEFAULT_PRODUCTS = [
  { id: "p1", cat: "Moisturise", kind: "bottle", name: "Rosewater & Aloe Loc Spritz", size: "250 ml", price: 850, stock: 24, desc: "Light daily mist that won’t leave residue." },
  { id: "p2", cat: "Cleanse", kind: "bottle", name: "Residue-Free Clarifying Shampoo", size: "300 ml", price: 1200, stock: 3, desc: "Rinses clean out of the centre of each loc." },
  { id: "p3", cat: "Hold", kind: "jar", name: "Aloe Locking Gel", size: "200 g", price: 700, stock: 31, desc: "Flake-free hold for retwists." },
  { id: "p4", cat: "Moisturise", kind: "bottle", name: "Jamaican Black Castor Oil", size: "120 ml", price: 950, stock: 12, desc: "For scalp and new growth only." },
  { id: "p5", cat: "Accessories", kind: "beads", name: "Gold Loc Cuffs", size: "Set of 20", price: 600, stock: 45, desc: "Adjustable cuffs for locs up to 8 mm thick." },
  { id: "p6", cat: "Accessories", kind: "bonnet", name: "Satin-Lined Loc Sock", size: "One size, long", price: 900, stock: 0, desc: "Protects locs from lint and frizz overnight." },
  { id: "p7", cat: "Accessories", kind: "hook", name: "Interlocking Tool Set", size: "3 sizes", price: 750, stock: 9, desc: "Latch tools for micro, medium and thick locs." },
  { id: "p8", cat: "Cleanse", kind: "box", name: "At-Home Loc Detox Kit", size: "2 soaks", price: 1800, stock: 6, desc: "ACV rinse, clarifying wash and a microfibre towel." },
];

export const DEFAULT_SETTINGS = {
  name: "Twins Locs Arena",
  tagline: "Enjoy the beauty in locs",
  currency: "KSh",
  depositPct: 30,
  deliveryFee: 300,
  freeOver: 5000,
  chairs: 2,
  open: 8,
  close: 18,
  timezone: "Africa/Nairobi",
  whatsapp: "",
  phone: "Add your phone number in Admin → Settings",
  address: "Add your salon address in Admin → Settings",
  hours: "Mon–Sat, 8:00–18:00 · Sun by appointment",
};
