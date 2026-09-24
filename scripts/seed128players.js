/**
 * Seed 128 realistic players directly into the tournament_players DB table.
 * Run: node scripts/seed128players.js
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Data pools ────────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Ali','Usman','Hassan','Ibrahim','Bilal','Hamza','Zain','Omar','Faisal','Asad',
  'Tariq','Imran','Kamran','Waheed','Shahid','Rizwan','Nasir','Adeel','Saad','Junaid',
  'Yasir','Talha','Fahad','Waqas','Haris','Shoaib','Zeeshan','Salman','Aqib','Babar',
  'Mohsin','Danish','Ammar','Noman','Rafiq','Khalid','Muneeb','Hasnain','Uzair','Rehan',
  'Ahsan','Umar','Sohail','Jawad','Irfan','Omer','Raees','Zohaib','Shehryar','Daniyal',
  'Waseem','Naeem','Kashif','Tahir','Shafiq','Zahid','Nadeem','Amir','Aamir','Wajid',
  'Furqan','Asim','Ghulam','Pervez','Mudassar','Tanveer','Arfan','Sarfraz','Haroon','Afnan',
];
const LAST_NAMES = [
  'Khan','Butt','Malik','Sheikh','Chaudhry','Rana','Raja','Mirza','Siddiqui','Qureshi',
  'Ansari','Gill','Warraich','Bhatti','Niazi','Abbasi','Hashmi','Lodhi','Bokhari','Tiwana',
  'Bajwa','Cheema','Sandhu','Virk','Dogar','Gondal','Tarar','Arain','Mughal','Syed',
  'Afridi','Yousuf','Hussain','Ahmad','Mehmood','Maqsood','Pervaiz','Akram','Zaheer','Asif',
];
const CITIES = [
  'Faisalabad','Lahore','Karachi','Islamabad','Rawalpindi','Multan','Gujranwala',
  'Sialkot','Sheikhupura','Sargodha','Hyderabad','Peshawar','Bahawalpur','Sahiwal',
];
const SKILLS = [
  'Dribbling & Pace','Finishing & Composure','Long Shots','Free Kicks & Set Pieces',
  'Defending & Tackling','Aerial Duels & Heading','Vision & Passing','One-Touch Play',
  'Crossing & Delivery','Goalkeeping Reflexes','Counter-Attacking','Ball Control',
  'Physicality & Strength','Quick Feet & Agility',
];
const FEET = ['Right','Left','Both'];
const KEEPERS = ['Goalkeeper A','Goalkeeper B','Either'];
const PAYMENT_METHODS = ['EasyPaisa/Cash','JazzCash','Bank Transfer','Cash'];
const PAYMENT_STATUSES = ['NOT_SUBMITTED','NOT_SUBMITTED','NOT_SUBMITTED','PENDING','VERIFIED'];
const APPROVAL_STATUSES = ['PENDING','PENDING','APPROVED','APPROVED','REJECTED'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function phone() {
  const p = ['0300','0301','0302','0303','0311','0312','0313','0321','0322','0333','0345','0346'];
  return pick(p) + String(Math.floor(1000000 + Math.random() * 9000000));
}

// ── Generate 128 unique players ───────────────────────────────────────────────
const seen = new Set();
const players = [];
let attempt = 0;

while (players.length < 128 && attempt < 5000) {
  attempt++;
  const fn = pick(FIRST_NAMES);
  const ln = pick(LAST_NAMES);
  const name = `${fn} ${ln}`;
  const idx  = players.length + 1;
  const gmail = `${fn.toLowerCase()}.${ln.toLowerCase()}${idx}@gmail.com`;
  if (seen.has(gmail)) continue;
  seen.add(gmail);

  const paymentStatus  = pick(PAYMENT_STATUSES);
  const approvalStatus = paymentStatus === 'VERIFIED' ? 'APPROVED'
                       : paymentStatus === 'PENDING'  ? pick(['PENDING','APPROVED'])
                       : 'PENDING';
  const checkedIn      = approvalStatus === 'APPROVED' && paymentStatus === 'VERIFIED' && Math.random() > 0.5;
  const seed           = `S${String(idx).padStart(3,'0')}`;
  const goals          = Math.floor(Math.random() * 12);
  const shots          = goals + Math.floor(Math.random() * 8);
  const matches        = Math.floor(Math.random() * 6);

  players.push({
    id:               'P-' + crypto.randomBytes(5).toString('hex').toUpperCase(),
    name,
    seed,
    status:           'Active',
    goals,
    shots,
    matches,
    gmail_address:    gmail,
    cell_phone:       phone(),
    whatsapp_contact: phone(),
    photo_url:        null,
    preferred_keeper: pick(KEEPERS),
    dominant_foot:    pick(FEET),
    city:             pick(CITIES),
    bio:              `${fn} is a passionate footballer from ${pick(CITIES)} ready to compete.`,
    best_skills:      pick(SKILLS),
    game_videos:      [],
    payment_status:   paymentStatus,
    payment_ref:      paymentStatus !== 'NOT_SUBMITTED' ? 'REF-' + crypto.randomBytes(3).toString('hex').toUpperCase() : null,
    payment_method:   pick(PAYMENT_METHODS),
    approval_status:  approvalStatus,
    checked_in:       checkedIn,
    notes:            null,
  });
}

if (players.length < 128) {
  console.error(`Only generated ${players.length} unique players — try again.`);
  process.exit(1);
}

// ── Insert into DB ────────────────────────────────────────────────────────────
console.log(`Inserting ${players.length} players…`);
let inserted = 0;
let skipped  = 0;

for (const p of players) {
  try {
    await pool.query(
      `INSERT INTO tournament_players
         (id,name,seed,status,goals,shots,matches,
          gmail_address,cell_phone,whatsapp_contact,photo_url,
          preferred_keeper,dominant_foot,city,bio,best_skills,
          game_videos,payment_status,payment_ref,payment_method,
          approval_status,checked_in,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17::jsonb,$18,$19,$20,$21,$22,$23)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.id, p.name, p.seed, p.status, p.goals, p.shots, p.matches,
        p.gmail_address, p.cell_phone, p.whatsapp_contact, p.photo_url,
        p.preferred_keeper, p.dominant_foot, p.city, p.bio, p.best_skills,
        JSON.stringify(p.game_videos),
        p.payment_status, p.payment_ref, p.payment_method,
        p.approval_status, p.checked_in, p.notes,
      ]
    );
    inserted++;
    process.stdout.write(`\r  ${inserted}/128 inserted`);
  } catch (err) {
    console.warn(`\n  Skipped ${p.name}: ${err.message}`);
    skipped++;
  }
}

const { rows } = await pool.query('SELECT COUNT(*) FROM tournament_players');
console.log(`\n\nDone! Inserted: ${inserted}  Skipped: ${skipped}`);
console.log(`Total players now in DB: ${rows[0].count}`);
await pool.end();
process.exit(0);
