import dotenv from 'dotenv';
import { createClient } from 'redis';

dotenv.config();

// --- All whitelisted users ---
const initialWhitelist = [
  'ics.learning.ashoka@gmail.com',
  'aalok.thakkar@ashoka.edu.in',
  'aadi.grover_ug2024@ashoka.edu.in',
  'adityaveer.dahiya_ug25@ashoka.edu.in',
  'anushka.garimella_ug2024@ashoka.edu.in',
  'aryan.gupta_ug2024@ashoka.edu.in',
  'cian.chengappa_ug2024@ashoka.edu.in',
  'denzel.chinda_ug2024@ashoka.edu.in',
  'fateh.gyani_ug25@ashoka.edu.in',
  'joanne.korah_ug2024@ashoka.edu.in',
  'keerthana.panchanathan_ug25@ashoka.edu.in',
  'larry.tayenjam_ug2024@ashoka.edu.in',
  'lerno.parion_ug2024@ashoka.edu.in',
  'madhurima.banerjee_ug2023@ashoka.edu.in',
  'megha.mudakkayil_ug2024@ashoka.edu.in',
  'mohammad.rahman_ug2024@ashoka.edu.in',
  'monika.pandey_ug2024@ashoka.edu.in',
  'munashe.nyagono_ug2024@ashoka.edu.in',
  'naman.anshumaan_ug2024@ashoka.edu.in',
  'raj.karan_ug2024@ashoka.edu.in',
  'samyak.khobragade_ug2024@ashoka.edu.in',
  'shristi.sharma_ug2024@ashoka.edu.in',
  'surya.singh_ug2023@ashoka.edu.in',
  'vedant.rana_ug2023@ashoka.edu.in',
  'velpula.raju_ug2024@ashoka.edu.in',
  'yashita.mishra_ug2024@ashoka.edu.in',
  'charchit.agarwal_ug2023@ashoka.edu.in',
  'vedant.gautam_ug2023@ashoka.edu.in'
];

// --- Admins (must also be part of the whitelist) ---
const initialAdmins = [
  'ics.learning.ashoka@gmail.com',
  'aalok.thakkar@ashoka.edu.in'
];

async function seedData() {
  if (!process.env.REDIS_URL) {
    console.error('Error: REDIS_URL is not defined in your .env file.');
    return;
  }

  const redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => console.error('Redis Client Error', err));

  try {
    await redisClient.connect();
    console.log(' Connected to Redis...');

    const whitelistKey = 'whitelisted_emails';
    const adminKey = 'admin_emails';

    // --- Seed whitelist ---
    const whitelistResult = await redisClient.sAdd(whitelistKey, initialWhitelist);
    console.log(` Added ${whitelistResult} new emails to whitelist.`);

    const whitelistCount = await redisClient.sCard(whitelistKey);
    console.log(`Whitelist total: ${whitelistCount}`);

    // --- Seed admins (ensures they’re also in the whitelist) ---
    const adminResult = await redisClient.sAdd(adminKey, initialAdmins);
    console.log(`Added ${adminResult} new emails to admin list.`);

    // Double-check: add admins into whitelist too (in case someone forgot)
    await redisClient.sAdd(whitelistKey, initialAdmins);

    const adminCount = await redisClient.sCard(adminKey);
    console.log(`Admin list total: ${adminCount}`);

  } catch (err) {
    console.error('Failed to seed data:', err);
  } finally {
    await redisClient.quit();
    console.log('Disconnected from Redis.');
  }
}

seedData();
