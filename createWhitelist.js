// create-initial-whitelist.js
import authService from './services/authService.js';

const initialEmails = [
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



initialEmails.forEach(email => {
  authService.addToWhitelist(email);
  console.log(`Added: ${email}`);
});

console.log('Initial whitelist created!');