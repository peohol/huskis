package no.huskis.app;

import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Regner et planlagt Huskis-varsel om fra ETT absolutt tidspunkt til ET ANNET,
 * slik at det fortsatt ringer på den samme LOKALE veggtiden etter at telefonen
 * har byttet tidssone.
 *
 * <p>Hvorfor dette finnes: {@code @capacitor/local-notifications} planlegger
 * gjennom {@code AlarmManager.RTC_WAKEUP} med et absolutt millisekund, og
 * Android dokumenterer den alarmtypen som basert på
 * {@code System.currentTimeMillis()} — altså UTC. Bytter telefonen sone, står
 * alarmen igjen på det samme instantet og ringer på feil klokkeslett. Pluginen
 * har ingen mekanisme for det: manifestet dens lytter bare på oppstart
 * ({@code BOOT_COMPLETED} og slektningene), ikke på
 * {@code TIMEZONE_CHANGED}.</p>
 *
 * <p>Klassen kjenner IKKE én eneste varselregel. Den vet ingenting om frister,
 * terskler, uker eller hva et varsel betyr — alt det bor i generatoren i
 * {@code app.js} og skal bo ett sted. Det eneste den gjør er å lese den
 * veggtiden JS allerede la ved alarmen ({@code extra.wall}) og regne den om i
 * gjeldende sone. Ren, uten Android-avhengigheter, og derfor prøvbar som en
 * vanlig JVM-test ({@code HuskisWallClockTest}).</p>
 */
public final class HuskisWallClock {

    private HuskisWallClock() { }

    /** Formen pluginen lagrer {@code schedule.at} i — alltid UTC. */
    private static final String LAGRET_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";

    /** Formen {@code notifWallClock()} i app.js skriver: lokal tid, uten sone. */
    private static final String VEGG_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSS";

    /** Ugyldig veggtid. */
    public static final long UGYLDIG = -1L;

    /**
     * Lokal veggtid («2026-09-04T09:00:00.000») → det absolutte millisekundet
     * den peker på i {@code tz}.
     *
     * <p>Sommertid håndteres av {@link Calendar} selv, på samme måte som
     * {@code new Date(år, …)} gjør det i JS: en veggtid som ikke finnes (natten
     * klokka stilles fram) eller finnes to ganger (natten den stilles tilbake)
     * får den samme deterministiske tolkningen på begge sider.</p>
     *
     * @return millisekunder, eller {@link #UGYLDIG} om strengen ikke har formen.
     */
    public static long wallClockToMillis(String wall, TimeZone tz) {
        return parseStreng(wall, VEGG_FORMAT, tz);
    }

    /**
     * Streng parsing: HELE strengen må gå opp i mønsteret.
     *
     * <p>{@link SimpleDateFormat#parse(String)} stopper så snart mønsteret er
     * dekket og bryr seg ikke om resten — «2026-09-04T09:00:00.000Z» ville
     * dermed blitt lest som lokal veggtid, med Z-en ignorert, og en alarm
     * plassert timer feil uten at noe klaget. Derfor {@link ParsePosition}, og
     * et krav om at posisjonen har nådd slutten.</p>
     */
    private static long parseStreng(String tekst, String mønster, TimeZone tz) {
        if (tekst == null || tekst.isEmpty() || tz == null) return UGYLDIG;
        SimpleDateFormat sdf = new SimpleDateFormat(mønster, Locale.US);
        sdf.setTimeZone(tz);
        sdf.setLenient(false);
        ParsePosition pos = new ParsePosition(0);
        Date d = sdf.parse(tekst, pos);
        if (d == null || pos.getIndex() != tekst.length()) return UGYLDIG;
        return d.getTime();
    }

    /** Absolutt millisekund → den formen pluginen lagrer {@code schedule.at} i. */
    public static String millisToStored(long ms) {
        SimpleDateFormat sdf = new SimpleDateFormat(LAGRET_FORMAT, Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date(ms));
    }

    /** Den lagrede {@code schedule.at} → millisekunder, eller {@link #UGYLDIG}. */
    public static long storedToMillis(String at) {
        return parseStreng(at, LAGRET_FORMAT, TimeZone.getTimeZone("UTC"));
    }

    /**
     * Ett lagret varsel, omregnet til {@code tz}.
     *
     * <p>Returnerer den oppdaterte JSON-en, eller {@code null} når raden ikke
     * skal røres. Alt annet enn {@code schedule.at} står urørt — ID-en, teksten
     * og hele {@code extra} følger med uendret, for de er ikke kopiert: det er
     * det samme objektet med ett felt satt om.</p>
     *
     * <p>Fire grunner til å la den stå:</p>
     * <ol>
     *   <li>ingen {@code extra.wall} — da er den ikke Huskis' å flytte;</li>
     *   <li>avlyst, eller uten {@code schedule.at};</li>
     *   <li><b>tidspunktet har alt passert</b> — alarmen har ringt, og å sette
     *       den på nytt ville gitt et duplikat;</li>
     *   <li>det nye tidspunktet er det samme som det gamle — telefonen står i
     *       en sone med samme forskyvning, og det er ingenting å gjøre.</li>
     * </ol>
     *
     * <p>Punkt 3 er den viktige: bare alarmer som ENNÅ ikke har ringt flyttes.
     * At det nye tidspunktet kan ligge i fortiden (man reiser østover, og
     * klokka der er alt passert) er derimot riktig — pluginen leverer da
     * varselet med det samme, akkurat som den gjør for et varsel som forfalt
     * mens telefonen var avslått.</p>
     */
    public static String retimeStoredNotification(String json, TimeZone tz, long now) {
        if (json == null || tz == null) return null;
        JSONObject o;
        try {
            o = new JSONObject(json);
        } catch (JSONException e) {
            return null;
        }
        if (o.optBoolean("cancelled", false)) return null;

        JSONObject extra = o.optJSONObject("extra");
        if (extra == null) return null;
        String wall = extra.optString("wall", null);
        if (wall == null || wall.isEmpty()) return null;

        JSONObject schedule = o.optJSONObject("schedule");
        if (schedule == null) return null;
        long gammel = storedToMillis(schedule.optString("at", null));
        if (gammel == UGYLDIG) return null;
        if (gammel <= now) return null;                 // har alt ringt — ikke rør

        long ny = wallClockToMillis(wall, tz);
        if (ny == UGYLDIG || ny == gammel) return null;

        try {
            schedule.put("at", millisToStored(ny));
        } catch (JSONException e) {
            return null;
        }
        return o.toString();
    }
}
