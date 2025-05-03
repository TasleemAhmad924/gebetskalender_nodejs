import axios from 'axios';
import { DateTime } from 'luxon';
import ical, { ICalCalendar } from 'ical-generator';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';



// Typdefinitionen
interface Prayer {
  name: string;
  begins: string;
}

interface PrayerTimesResponse {
  prayers: Prayer[];
  date: string;
  hijriDate: string;
}

// Konfiguration
const OBLIGATORY_PRAYERS = ['Fajr', 'Zuhr', 'Asr', 'Maghrib', 'Isha'];
const TIME_ZONE = 'Europe/Berlin';
const URL = 'https://www.alislam.org/adhan';
const ICS_FILE_NAME = 'gebetszeiten.ics';
const EVENT_DURATION_MINUTES = 10;

async function fetchPrayerTimes(): Promise<PrayerTimesResponse | null> {
  try {
    const response = await axios.get(URL);
    const html = response.data;

    const jsonMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
    if (!jsonMatch) throw new Error('__NEXT_DATA__ script nicht gefunden');

    const nextData = JSON.parse(jsonMatch[1]);
    const multiDay = nextData.props.pageProps.defaultSalatInfo.multiDayTimings;

    const today = DateTime.now().setZone(TIME_ZONE);
    const todayFormatted = today.toFormat('yyyy-MM-dd');

    let todayData = multiDay.find((day: any) => {
      const date = DateTime.fromMillis(day.date, { zone: TIME_ZONE }).toISODate();
      return date === todayFormatted;
    });

    if (!todayData || !Array.isArray(todayData.prayers)) {
      console.warn(`⚠️ Keine Gebetszeiten für ${todayFormatted} gefunden, fallback auf ersten verfügbaren Tag.`);
      todayData = multiDay[0];
    }

    const usedDate = DateTime.fromMillis(todayData.date, { zone: TIME_ZONE }).toISODate();
    const prayerTimesResponse: PrayerTimesResponse = {
      prayers: todayData.prayers.map((prayer: any) => ({
        name: prayer.name,
        begins: DateTime.fromMillis(prayer.time, { zone: TIME_ZONE }).toFormat('HH:mm')
      })),
      date: usedDate || '',
      hijriDate: todayData.hijriDate || ''
    };

    return prayerTimesResponse;
  } catch (error) {
    console.error('❌ Fehler beim Abrufen der Gebetszeiten:', error);
    return null;
  }
}

function createICSFile(prayerData: PrayerTimesResponse): void {
  const calendar: ICalCalendar = ical({
    name: 'Muslimische Gebetszeiten',
    prodId: '//alislam.org//Gebetszeiten//DE'
  });

  const [year, month, day] = prayerData.date.split('-').map(Number);
  const prayers = prayerData.prayers.filter(prayer =>
    OBLIGATORY_PRAYERS.includes(prayer.name)
  );

  if (prayers.length === 0) {
    console.warn('⚠️ Keine Pflichtgebete gefunden – ICS-Datei wird nicht erstellt.');
    return;
  }

  prayers.forEach(prayer => {
    const [hours, minutes] = prayer.begins.split(':').map(Number);

    // ✅ Korrekte Berlin-Zeit mit Datum
    const prayerTimeBerlin = DateTime.fromObject(
      { year, month, day, hour: hours, minute: minutes },
      { zone: TIME_ZONE }
    );

    const prayerTimeUTC = prayerTimeBerlin.toUTC();
    const endTimeUTC = prayerTimeUTC.plus({ minutes: EVENT_DURATION_MINUTES });

    const eventId = `${prayer.name}-${prayerTimeBerlin.toFormat('yyyyMMdd')}-${uuidv4()}`;

    const event = calendar.createEvent({
      summary: `${prayer.name} Gebet`,
      start: prayerTimeUTC.toJSDate(),
      end: endTimeUTC.toJSDate(),
      description: `${prayer.name} Gebetszeit automatisch aus alislam.org`,
    });

    // 👇 bleibt wie von dir definiert
    event.uid(eventId);
  });

  const outputDir = path.join(__dirname, 'docs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  const filePath = path.join(outputDir, ICS_FILE_NAME);
  console.log("📁 Schreibe ICS-Datei nach:", filePath);

  try {
    fs.writeFileSync(filePath, calendar.toString());
    console.log('✅ gebetszeiten.ics erfolgreich erstellt!');
  } catch (err) {
    console.error('❌ Fehler beim Schreiben der ICS-Datei:', err);
  }
}


async function main() {
  console.log('🟡 Skript gestartet...');
  console.log(`Datum: ${DateTime.now().setZone(TIME_ZONE).toFormat('dd.MM.yyyy')}`);
  console.log(`Zeitzone: ${TIME_ZONE}`);

  console.log(`🧭 Systemzeit: ${new Date().toISOString()}`);
  console.log(`🧭 Luxon-Zeit: ${DateTime.now().setZone(TIME_ZONE).toISO()}`);


  const prayerData = await fetchPrayerTimes();

  if (!prayerData) {
    console.error('❌ Fehler: Konnte keine Gebetszeiten abrufen.');
    process.exit(1);
  }

  const obligatoryPrayers = prayerData.prayers.filter(prayer =>
    OBLIGATORY_PRAYERS.includes(prayer.name)
  );

  obligatoryPrayers.forEach(prayer => {
    console.log(`${prayer.name}: ${prayer.begins} Uhr`);
  });

  createICSFile(prayerData);
}

main().catch(error => {
  console.error('❌ Fehler im Hauptprozess:', error);
  process.exit(1);
});
