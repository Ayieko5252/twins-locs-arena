// What a brand-new database starts with: salon settings, the loc menu, the
// shop shelf, the chart of accounts and the AI team.

export const DEFAULT_SETTINGS = {
  name: "Twins Locs Arena",
  tagline: "Enjoy the beauty in locs",
  currency: "KSh",
  timezone: "Africa/Nairobi",
  depositPct: 30,
  deliveryFee: 300,
  freeOver: 5000,
  chairs: 2,
  open: 0,   // clients may book at any hour, including night visits
  close: 24,
  vatPct: 16,
  vatInclusive: 1,
  defaultMarkupPct: 60,
  discountCapPct: 15,
  approvalOverCents: 1000000, // KSh 10,000 needs management approval
  whatsapp: "254113394402",
  phone: "+254 113 394402",
  phone2: "+254 741 569288",
  supportEmail: "support@twinslocsarena.com",
  salesEmail: "sales@twinslocsarena.com",
  bookingsEmail: "bookings@twinslocsarena.com",
  address: "Eldoret, Uasin Gishu, Kenya",
  hours: "Open 24 hours, 7 days a week",
  googleClientId: "",
  googleSiteVerification: "", // the code Google Search Console gives you
  loyaltyVisitsForReward: 6,
  staffDomain: "twinslocsarena.com", // staff may sign in with just the username
};

// The accounts the salon starts with. Everyone gets the same starter password,
// chosen by the owner when the accounts are created, and is asked to change it
// the first time they sign in.
export const DEFAULT_STAFF = [
  { username: "owner",      name: "Salon Owner",            title: "Owner",                        department: "management", role: "owner" },
  { username: "manager",    name: "General Manager",        title: "General manager",              department: "management", role: "head" },
  { username: "chiefdev",   name: "Chief Software Engineer",title: "Chief software engineer",      department: "management", role: "head" },
  { username: "dev",        name: "Senior Software Engineer",title: "Senior software engineer",    department: "management", role: "staff" },
  { username: "ui",         name: "Senior UI Engineer",     title: "Senior UI engineer",           department: "management", role: "staff" },
  { username: "admin",      name: "Administrator",          title: "Administration head",          department: "admin",      role: "head" },
  { username: "frontdesk",  name: "Front Desk",             title: "Front desk & bookings",        department: "admin",      role: "staff" },
  { username: "marketer",   name: "Senior Marketer",        title: "Senior marketer",              department: "admin",      role: "staff" },
  { username: "accountant", name: "Senior Accountant",      title: "Senior accountant",            department: "accounts",   role: "head" },
  { username: "bookkeeper", name: "Bookkeeper",             title: "Bookkeeper",                   department: "accounts",   role: "staff" },
  { username: "cosmetics",  name: "Chief Cosmetics Expert", title: "Chief cosmetics expert",       department: "employee",   role: "head" },
  { username: "sales",      name: "Senior Cosmetic Salesperson", title: "Senior cosmetic salesperson", department: "employee", role: "staff" },
  { username: "loctician",  name: "Senior Loctician",       title: "Senior loctician",             department: "employee",   role: "staff" },
];

// The starter password is never written down in this repository, because the
// repository is public. It is passed to scripts/make-accounts.mjs when the
// accounts are created, and the owner keeps it.

export const DEFAULT_SERVICES = [
  { id: "s1", cat: "Start", name: "Starter locs", price: 350000, dur: "3-4 hrs", care: "First retwist in 4 weeks", descr: "Comb coils or two-strand twists on natural hair, sized to how you want your locs to look." },
  { id: "s2", cat: "Start", name: "Instant locs", price: 800000, dur: "5-7 hrs", care: "Low-maintenance from day one", descr: "Fully formed locs in one session using the crochet method. No budding stage." },
  { id: "s3", cat: "Start", name: "Microlocs installation", price: 1800000, dur: "2 sessions", care: "Interlock every 6-8 wks", descr: "Small, uniform locs set with a grid pattern. We do a consultation first." },
  { id: "s4", cat: "Maintain", name: "Retwist & style", price: 150000, dur: "2 hrs", care: "Every 4-6 wks", descr: "Palm-roll retwist of new growth with a light gel, finished with a simple style." },
  { id: "s5", cat: "Maintain", name: "Interlocking maintenance", price: 200000, dur: "2-3 hrs", care: "Every 6-8 wks", descr: "Tool-pulled roots that hold longer than a retwist. Good for active lifestyles." },
  { id: "s6", cat: "Maintain", name: "Loc detox", price: 120000, dur: "1.5 hrs", care: "Every 3 months", descr: "Apple cider vinegar and baking soda soak to lift build-up and lint, then a deep rinse." },
  { id: "s7", cat: "Repair", name: "Loc repair & reattachment", price: 80000, dur: "1 hr", care: "As needed", descr: "Fixes thinning points and reattaches broken locs. Price is per 10 locs." },
  { id: "s8", cat: "Repair", name: "Loc extensions", price: 1200000, dur: "6-8 hrs", care: "Retwist every 4-6 wks", descr: "Human-hair extensions added to your locs for length or fullness. Price covers 50 locs." },
  { id: "s9", cat: "Style", name: "Barrel twists or petals", price: 100000, dur: "1.5 hrs", care: "Lasts 1-2 wks", descr: "Barrel rolls, petal buns or a loc updo for events. Includes finishing with gold cuffs." },
  { id: "s10", cat: "Style", name: "Loc bob & colour", price: 450000, dur: "3 hrs", care: "Colour refresh in 8 wks", descr: "Shaping cut plus semi-permanent colour on the ends or all over." },
];

// cost_cents is what the salon pays; price_cents is cost + markup.
export const DEFAULT_PRODUCTS = [
  { id: "p1", family: "spritz", cat: "Moisturise", kind: "bottle", name: "Rosewater & Aloe Loc Spritz", size: "250 ml", cost: 50000, markup: 70, price: 85000, stock: 24, descr: "Light daily mist that won’t leave residue." },
  { id: "p2", family: "shampoo", cat: "Cleanse", kind: "bottle", name: "Residue-Free Clarifying Shampoo", size: "300 ml", cost: 70000, markup: 71, price: 120000, stock: 3, descr: "Rinses clean out of the centre of each loc." },
  { id: "p3", family: "gel", cat: "Hold", kind: "jar", name: "Aloe Locking Gel", size: "200 g", cost: 40000, markup: 75, price: 70000, stock: 31, descr: "Flake-free hold for retwists." },
  { id: "p4", family: "oil", cat: "Moisturise", kind: "bottle", name: "Jamaican Black Castor Oil", size: "120 ml", cost: 55000, markup: 73, price: 95000, stock: 12, descr: "For scalp and new growth only." },
  { id: "p5", family: "cuffs", cat: "Accessories", kind: "beads", name: "Gold Loc Cuffs", size: "Set of 20", cost: 30000, markup: 100, price: 60000, stock: 45, descr: "Adjustable cuffs for locs up to 8 mm thick." },
  { id: "p6", family: "sleep", cat: "Accessories", kind: "bonnet", name: "Satin-Lined Loc Sock", size: "One size, long", cost: 45000, markup: 100, price: 90000, stock: 0, descr: "Protects locs from lint and frizz overnight." },
  { id: "p7", family: "tools", cat: "Accessories", kind: "hook", name: "Interlocking Tool Set", size: "3 sizes", cost: 35000, markup: 114, price: 75000, stock: 9, descr: "Latch tools for micro, medium and thick locs." },
  { id: "p8", family: "detox", cat: "Cleanse", kind: "box", name: "At-Home Loc Detox Kit", size: "2 soaks", cost: 100000, markup: 80, price: 180000, stock: 6, descr: "ACV rinse, clarifying wash and a microfibre towel." },
];

// Simple small-business chart of accounts.
export const CHART_OF_ACCOUNTS = [
  ["1000", "Cash on hand", "asset"],
  ["1010", "M-Pesa till", "asset"],
  ["1020", "Bank account", "asset"],
  ["1100", "Money owed to us", "asset"],
  ["1200", "Stock on hand", "asset"],
  ["2000", "Money we owe", "liability"],
  ["2100", "Deposits held for clients", "liability"],
  ["2200", "VAT payable", "liability"],
  ["3000", "Owner capital", "equity"],
  ["3100", "Retained earnings", "equity"],
  ["4000", "Service income", "income"],
  ["4100", "Product sales", "income"],
  ["4900", "Discounts given", "income"],
  ["5000", "Cost of products sold", "expense"],
  ["5100", "Salon supplies", "expense"],
  ["5200", "Wages", "expense"],
  ["5300", "Rent", "expense"],
  ["5400", "Electricity & water", "expense"],
  ["5500", "Transport & delivery", "expense"],
  ["5600", "Marketing", "expense"],
  ["5700", "Bank & M-Pesa charges", "expense"],
  ["5800", "Repairs & maintenance", "expense"],
  ["5900", "Other costs", "expense"],
];

// The AI team. Each brief is what the agent is told it is; the answer always
// gets the salon's own live numbers added before it is sent.
export const DEFAULT_AGENTS = [
  {
    id: "chief_cosmetics",
    name: "Chief Cosmetics Expert",
    title: "Chief cosmetics & trichology expert",
    department: "employee",
    brief: "You are the chief cosmetics and loc-care expert at Twins Locs Arena in Kenya. You know scalp health, loc stages (starter, budding, teen, mature), porosity, product build-up, and ingredients that help or harm locs (humectants, heavy butters, petrolatum, protein). Give practical chair-side advice a loctician can use today, in plain words, with quantities and timings. Flag anything that needs a dermatologist instead of a salon. Never recommend a product the salon does not stock without saying it is not in stock.",
    skills: ["Scalp and loc diagnosis", "Product ingredients", "Treatment plans", "Client aftercare"],
    starters: ["A client has itchy flaking scalp with build-up - what do we do today?", "Which of our products suit high-porosity starter locs?", "Write aftercare instructions for microlocs."],
    sort: 1,
  },
  {
    id: "senior_sales",
    name: "Senior Cosmetic Salesperson",
    title: "Senior cosmetics salesperson",
    department: "employee",
    brief: "You are a senior cosmetics salesperson at Twins Locs Arena. You turn salon visits into product sales without pressure: you match products to what the loctician found on the client's hair, explain value in shillings per week of use, and suggest sensible bundles. You know the shop stock, prices and what is low or sold out. Never promise a discount beyond the salon's discount cap, and never push a product that is out of stock.",
    skills: ["Matching products to hair needs", "Bundles and upsells", "Objection handling", "Follow-up scripts"],
    starters: ["Suggest a bundle for a client who just had a retwist.", "What should I say when a client says the spritz is expensive?", "Which slow-moving stock should we promote this week?"],
    sort: 2,
  },
  {
    id: "senior_marketer",
    name: "Senior Marketer",
    title: "Senior marketer",
    department: "admin",
    brief: "You are a senior marketer for a loc salon in Eldoret, Kenya. You plan simple campaigns that work on WhatsApp, Instagram and TikTok for a small budget, write captions in Kenyan English that sound human, and design offers that protect margin. You use the salon's real booking gaps and stock levels to decide what to promote. Always state the cost, the expected bookings, and how to measure whether it worked.",
    skills: ["Campaign plans", "Captions and posts", "Offers that keep margin", "Referral and loyalty ideas"],
    starters: ["Plan a campaign to fill empty Tuesday and Wednesday chairs.", "Write five Instagram captions for our retwist service.", "Design a referral offer that keeps our margin."],
    sort: 3,
  },
  {
    id: "senior_accountant",
    name: "Senior Accountant",
    title: "Senior accountant",
    department: "accounts",
    brief: "You are a senior accountant for a small Kenyan salon business. You work in KSh, you understand VAT at 16% on VAT-inclusive prices, M-Pesa charges, and simple double-entry bookkeeping. You read the salon's own ledgers before answering, explain in plain words what the numbers mean, and name the exact journal entries to post. You never give legal or tax filing advice beyond general guidance, and you tell the owner when to speak to a licensed tax agent.",
    skills: ["Double-entry entries", "Profit and loss", "Cash book and reconciliation", "VAT and margins"],
    starters: ["Explain last month's profit and loss in plain words.", "What journal entries record a KSh 3,000 M-Pesa sale?", "Is our 60% markup enough after VAT?"],
    sort: 4,
  },
  {
    id: "senior_ui",
    name: "Senior UI Engineer",
    title: "Senior UI engineer",
    department: "management",
    brief: "You are a senior UI engineer who maintains the Twins Locs Arena website and staff hub. You work in plain HTML, CSS and JavaScript with no framework, you keep the salon's brand colours (sand #E9CB98, cocoa #2E170D, loc brown #7A4424, gold #D39A17), and you care about phones first, dark mode, and accessibility. You give exact code, you never add a dependency without saying why, and you keep pages fast.",
    skills: ["Page layout and components", "Phone-first CSS", "Accessibility", "Brand consistency"],
    starters: ["Review the booking sheet on a small phone screen.", "Add a loyalty card to the client portal.", "Improve contrast on the dark theme."],
    sort: 5,
  },
  {
    id: "senior_software",
    name: "Senior Software Engineer",
    title: "Senior software engineer",
    department: "management",
    brief: "You are a senior software engineer for the Twins Locs Arena system: a Cloudflare Worker, a D1 SQLite database, R2 file storage, and plain HTML pages. You write careful server code, validate every input, keep money in integer cents, and never trust the browser. You explain trade-offs briefly and give complete, working code with tests.",
    skills: ["Worker and D1 code", "Data model changes", "Tests", "Performance"],
    starters: ["Add a waiting list for fully booked days.", "Write tests for the stock ledger.", "How should we store recurring appointments?"],
    sort: 6,
  },
  {
    id: "chief_software",
    name: "Chief Software Engineer",
    title: "Chief software engineer (reviewer)",
    department: "management",
    brief: "You are the chief software engineer. You review work before it goes live: correctness, security, privacy, money handling, and whether the owner can actually operate it. You give a verdict (ship / fix first / stop), a numbered list of findings with severity, and the smallest change that fixes each one. You are blunt about risk and you never approve something you have not checked.",
    skills: ["Code review", "Security review", "Release decisions", "Risk calls"],
    starters: ["Review the last release for security problems.", "What could break when two staff edit stock at once?", "Is the client portal leaking any private data?"],
    sort: 7,
  },
];

// Blank company documents every salon should have on file.
export const DOCUMENT_TEMPLATES = [
  ["company", "Company constitution", "Who owns the business, who decides what, how profits are shared, and how disputes are settled."],
  ["company", "Staff terms and conditions", "Hours, pay dates, leave, conduct, client confidentiality and notice periods. Staff accept this at first sign-in."],
  ["company", "Client privacy notice", "What client details we keep, why, how long, and how a client can ask for theirs to be deleted."],
  ["employee", "Loctician service manual", "Step-by-step method for each service on the loc menu, with timings and product amounts."],
  ["employee", "Hygiene and tool sterilisation SOP", "How tools, towels and chairs are cleaned between clients."],
  ["employee", "Opening and closing checklist", "What to check when opening the salon and before locking up."],
  ["admin", "Booking and cancellation policy", "Deposits, late arrivals, no-shows and refunds."],
  ["admin", "Complaint handling procedure", "How a client complaint is recorded, who answers it, and in what time."],
  ["accounts", "Petty cash policy", "Who holds the float, what it may be spent on, and how receipts are filed."],
  ["accounts", "Month-end checklist", "Count stock, reconcile M-Pesa, post wages, review profit and loss."],
  ["management", "Price review record", "Date, old price, new price and the reason, for every price change."],
  ["management", "Supplier list", "Item names, lead times and prices. No supplier names are shown outside management."],
];
