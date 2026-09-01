/** Sample data for demoing the flow without typing. */

export const SAMPLE_NOTES: { label: string; kind: 'good' | 'garbage'; text: string }[] = [
  {
    label: 'Backyard remodel (full)',
    kind: 'good',
    text: `Site walk 9/1 — backyard remodel, roughly 60x40 usable.
Tear out ~600 sqft of old cracked concrete patio and haul away.
Client wants travertine paver patio approx 550 sqft where the concrete was.
Attached pergola off the back wall, about 16x12, stained cedar, wants fan pre-wire.
Gas fire pit, built-in, block + travertine cap to match patio. Gas line run ~30 ft from meter.
Artificial turf on the old lawn area, call it 900 sqft, with new drip conversion on the two citrus trees staying.
12 low-voltage path/accent lights along the new patio and seating wall.
Seating wall ~18 lnft around fire pit.
Access is decent — double gate on the north side. No HOA. Wants to start before Thanksgiving.`,
  },
  {
    label: 'Front yard refresh (small)',
    kind: 'good',
    text: `Front yard only. Rip out ~400 sqft of grass, convert to xeriscape.
Decomposed granite throughout (~700 sqft), 6 boulders, 15 desert plants (mix of agave/ocotillo).
Extend drip irrigation to new plants, new smart controller.
Paver walkway from driveway to front door, ~120 sqft, standard concrete pavers.
Budget-conscious — keep it clean and simple.`,
  },
  {
    label: 'Garbage input (guardrail demo)',
    kind: 'garbage',
    text: `asdf lol firetruck banana 42 the quick brown fox??? pool maybe idk client said something about vibes. purple monkey dishwasher`,
  },
]

export const SIMULATED_LEADS: Record<string, string>[] = [
  {
    full_name: 'Marcus & Elena Rivera',
    email: 'riveras@example.com',
    phone: '(602) 555-0184',
    address: '4212 E Camelback Rd, Phoenix, AZ',
    source: 'meta',
    project_type: 'Backyard remodel — patio + fire feature',
    budget_range: '$30K–$50K',
  },
  {
    full_name: 'Janet Okafor',
    email: 'janet.okafor@example.com',
    phone: '(480) 555-0139',
    address: '7801 N Scottsdale Rd, Scottsdale, AZ',
    source: 'google_lsa',
    project_type: 'Outdoor kitchen + pergola',
    budget_range: '$50K+',
  },
  {
    full_name: 'Bill & Nancy Hartman',
    email: 'hartmans@example.com',
    phone: '(623) 555-0117',
    address: '10233 W Thunderbird Blvd, Sun City, AZ',
    source: 'referral',
    project_type: 'Front yard xeriscape conversion',
    budget_range: '$15K–$30K',
  },
]
