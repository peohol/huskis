package no.huskis.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.TimeZone;

/**
 * Regresjonstest for det NATIVE laget: et planlagt varsel skal fortsatt
 * representere den samme LOKALE veggtiden etter et tidssonebytte — ikke det
 * samme UTC-instantet.
 *
 * <p>Dette er den ene delen av tidssoneoppførselen nettlesertesten ikke kan
 * nå: den beviser at Huskis retter alarmene når JS får kjøre. Her kjører ikke
 * JS i det hele tatt — dette er nøyaktig den omregningen
 * {@code TimeZoneAlarmReceiver} gjør når Android kringkaster
 * {@code TIMEZONE_CHANGED} mens appen er lukket.</p>
 *
 * <p>Kjøres på JVM-en, uten emulator:
 * {@code cd android && ./gradlew testDebugUnitTest}</p>
 */
public class HuskisWallClockTest {

    private static final TimeZone OSLO = TimeZone.getTimeZone("Europe/Oslo");
    private static final TimeZone TOKYO = TimeZone.getTimeZone("Asia/Tokyo");
    private static final TimeZone NEW_YORK = TimeZone.getTimeZone("America/New_York");

    /** 09:00 lokal tid 4. september 2026 — eksempelet i oppgaven. */
    private static final String VEGG = "2026-09-04T09:00:00.000";

    /** Alarmen slik pluginen faktisk lagrer den, med Huskis' egen `extra`. */
    private static String lagret(String at) {
        return "{\"id\":1234567,"
                + "\"title\":\"Julefrist\","
                + "\"body\":\"Frist utløpt\","
                + "\"schedule\":{\"at\":\"" + at + "\",\"allowWhileIdle\":true},"
                + "\"isExactNotification\":false,"
                + "\"extra\":{\"objType\":\"item\",\"objId\":\"abc\","
                + "\"key\":\"dueOver|item|abc|2026-09-04T09:00\","
                + "\"wall\":\"" + VEGG + "\"}}";
    }

    // ---------- 1. selve omregningen ----------

    @Test
    public void veggtidBlirRiktigInstantIHverSone() {
        // 09:00 4. sept er sommertid i Oslo (UTC+2) → 07:00Z.
        assertEquals("2026-09-04T07:00:00.000Z",
                HuskisWallClock.millisToStored(HuskisWallClock.wallClockToMillis(VEGG, OSLO)));
        // Tokyo er UTC+9 hele året → 00:00Z.
        assertEquals("2026-09-04T00:00:00.000Z",
                HuskisWallClock.millisToStored(HuskisWallClock.wallClockToMillis(VEGG, TOKYO)));
        // New York er på sommertid 4. sept (UTC-4) → 13:00Z.
        assertEquals("2026-09-04T13:00:00.000Z",
                HuskisWallClock.millisToStored(HuskisWallClock.wallClockToMillis(VEGG, NEW_YORK)));
    }

    @Test
    public void sommertidErEnEGENSAK_ogTasAvKalenderen() {
        // Samme veggtid, to sider av Oslos sommertidsovergang: forskyvningen
        // skal være ulik uten at noen regel her vet om overgangen.
        long sommer = HuskisWallClock.wallClockToMillis("2026-07-01T09:00:00.000", OSLO);
        long vinter = HuskisWallClock.wallClockToMillis("2026-12-01T09:00:00.000", OSLO);
        assertEquals("2026-07-01T07:00:00.000Z", HuskisWallClock.millisToStored(sommer));
        assertEquals("2026-12-01T08:00:00.000Z", HuskisWallClock.millisToStored(vinter));
    }

    @Test
    public void millisekunderBevares() {
        // En dato-frist uten klokkeslett har terskel 23:59:59.999. Et
        // minuttavrundet felt ville flyttet den nesten et minutt fram.
        long ms = HuskisWallClock.wallClockToMillis("2026-09-04T23:59:59.999", OSLO);
        assertEquals("2026-09-04T21:59:59.999Z", HuskisWallClock.millisToStored(ms));
    }

    @Test
    public void ugyldigVeggtidAvvises() {
        assertEquals(HuskisWallClock.UGYLDIG, HuskisWallClock.wallClockToMillis(null, OSLO));
        assertEquals(HuskisWallClock.UGYLDIG, HuskisWallClock.wallClockToMillis("", OSLO));
        assertEquals(HuskisWallClock.UGYLDIG, HuskisWallClock.wallClockToMillis("i går", OSLO));
        assertEquals(HuskisWallClock.UGYLDIG,
                HuskisWallClock.wallClockToMillis("2026-09-04T09:00:00.000Z", OSLO));
    }

    // ---------- 2. HOVEDSAKEN: reisen, uten at appen har kjørt ----------

    @Test
    public void alarmenFlytterSegTilSammeVeggtidIDenNyeSonen() throws Exception {
        // Planlagt i Oslo: 09:00 den 4. sept = 07:00Z.
        String instantA = "2026-09-04T07:00:00.000Z";
        // Telefonen er i Tokyo 1. sept. Appen har IKKE kjørt.
        long now = HuskisWallClock.storedToMillis("2026-09-01T00:00:00.000Z");

        String ut = HuskisWallClock.retimeStoredNotification(lagret(instantA), TOKYO, now);
        assertNotNull("alarmen skal flyttes", ut);

        JSONObject o = new JSONObject(ut);
        // Instant B: 09:00 Tokyo den 4. sept.
        assertEquals("2026-09-04T00:00:00.000Z", o.getJSONObject("schedule").getString("at"));

        // … og ALT annet står urørt: identiteten, teksten og pekeren.
        assertEquals(1234567, o.getInt("id"));
        assertEquals("Julefrist", o.getString("title"));
        assertEquals("Frist utløpt", o.getString("body"));
        assertEquals("dueOver|item|abc|2026-09-04T09:00", o.getJSONObject("extra").getString("key"));
        assertEquals("item", o.getJSONObject("extra").getString("objType"));
        assertEquals("abc", o.getJSONObject("extra").getString("objId"));
        assertEquals(VEGG, o.getJSONObject("extra").getString("wall"));
        assertTrue("alarmen skal fortsatt være upresis (ingen SCHEDULE_EXACT_ALARM)",
                !o.getBoolean("isExactNotification"));
        assertTrue("allowWhileIdle skal stå", o.getJSONObject("schedule").getBoolean("allowWhileIdle"));
    }

    @Test
    public void omregningenErStabil_ogGirIkkeEnNyEndringNesteGang() {
        long now = HuskisWallClock.storedToMillis("2026-09-01T00:00:00.000Z");
        String ut = HuskisWallClock.retimeStoredNotification(
                lagret("2026-09-04T07:00:00.000Z"), TOKYO, now);
        assertNotNull(ut);
        // Kjøres den samme sonen på nytt, er det ingenting å gjøre — og
        // «ingenting å gjøre» er null, ikke en ny skriving. Det er DET som
        // gjør at ingen dublettalarm kan oppstå.
        assertNull(HuskisWallClock.retimeStoredNotification(ut, TOKYO, now));
    }

    @Test
    public void reisenVestoverFlytterAlarmenSENERE() throws Exception {
        long now = HuskisWallClock.storedToMillis("2026-09-01T00:00:00.000Z");
        String ut = HuskisWallClock.retimeStoredNotification(
                lagret("2026-09-04T07:00:00.000Z"), NEW_YORK, now);
        assertNotNull(ut);
        assertEquals("2026-09-04T13:00:00.000Z",
                new JSONObject(ut).getJSONObject("schedule").getString("at"));
    }

    // ---------- 3. når den IKKE skal røres ----------

    @Test
    public void enAlarmSomAltHarRingtRoresIkke() {
        // Reist etter at varselet gikk: å sette det på nytt ville gitt et duplikat.
        long now = HuskisWallClock.storedToMillis("2026-09-04T10:00:00.000Z");
        assertNull(HuskisWallClock.retimeStoredNotification(
                lagret("2026-09-04T07:00:00.000Z"), TOKYO, now));
    }

    @Test
    public void sammeForskyvningGirIngenSkriving() {
        long now = HuskisWallClock.storedToMillis("2026-09-01T00:00:00.000Z");
        assertNull(HuskisWallClock.retimeStoredNotification(
                lagret("2026-09-04T07:00:00.000Z"), TimeZone.getTimeZone("Europe/Stockholm"), now));
    }

    @Test
    public void etVarselUtenVeggtidErIkkeVartAFlytte() {
        long now = HuskisWallClock.storedToMillis("2026-09-01T00:00:00.000Z");
        String fremmed = "{\"id\":9,\"title\":\"x\","
                + "\"schedule\":{\"at\":\"2026-09-04T07:00:00.000Z\"},"
                + "\"extra\":{\"objType\":\"item\"}}";
        assertNull(HuskisWallClock.retimeStoredNotification(fremmed, TOKYO, now));
        assertNull(HuskisWallClock.retimeStoredNotification(
                "{\"id\":9,\"schedule\":{\"at\":\"2026-09-04T07:00:00.000Z\"}}", TOKYO, now));
    }

    @Test
    public void avlystOgUtenTidspunktRoresIkke() {
        long now = HuskisWallClock.storedToMillis("2026-09-01T00:00:00.000Z");
        String avlyst = lagret("2026-09-04T07:00:00.000Z")
                .replace("{\"id\":1234567,", "{\"cancelled\":true,\"id\":1234567,");
        assertNull(HuskisWallClock.retimeStoredNotification(avlyst, TOKYO, now));

        String utenAt = "{\"id\":1,\"schedule\":{\"allowWhileIdle\":true},"
                + "\"extra\":{\"wall\":\"" + VEGG + "\"}}";
        assertNull(HuskisWallClock.retimeStoredNotification(utenAt, TOKYO, now));
    }

    @Test
    public void soppelInnGirNullUt() {
        assertNull(HuskisWallClock.retimeStoredNotification(null, TOKYO, 0L));
        assertNull(HuskisWallClock.retimeStoredNotification("ikke json", TOKYO, 0L));
        assertNull(HuskisWallClock.retimeStoredNotification(lagret("x"), TOKYO, 0L));
    }

    // ---------- 4. omstart ----------

    @Test
    public void denKorrigerteTidenErDENSomLagres() throws Exception {
        /* Pluginens egen oppstartsgjenoppretting leser `schedule.at` fra
           lagringen og planlegger på nytt derfra. Mottakeren skriver derfor
           denne JSON-en TILBAKE før alarmen settes — er den korrigert her, er
           den korrigert også etter en reboot. Går den rekkefølgen tapt,
           gjenoppstår det gamle tidspunktet. */
        long now = HuskisWallClock.storedToMillis("2026-09-01T00:00:00.000Z");
        String ut = HuskisWallClock.retimeStoredNotification(
                lagret("2026-09-04T07:00:00.000Z"), TOKYO, now);
        assertNotNull(ut);
        String etterReboot = new JSONObject(ut).getJSONObject("schedule").getString("at");
        assertEquals("2026-09-04T00:00:00.000Z", etterReboot);
        // … og en gjenoppretting i den samme sonen finner ingenting å endre.
        assertNull(HuskisWallClock.retimeStoredNotification(ut, TOKYO, now));
    }
}
