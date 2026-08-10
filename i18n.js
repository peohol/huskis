/* ============================================================
   Huskis — i18n.js

   Språket i UI-et: norsk (`no`) eller engelsk (`en`). Hele språkmodellen —
   hvor valget lagres, hvem som vinner, og hvordan e-postene følger etter — er
   beskrevet i docs/sprak.md, som er autoritativ.

   Fila er ren data + noen få funksjoner, og lastes FØR app.js. Den har ingen
   avhengigheter og rører ingen tilstand utenom `<html lang>` og
   `localStorage['huskis-lang']`.

   ORDBOKEN (`T`) har én nøkkel per tekst, med begge språkene på samme linje:

     'key': ['norsk tekst', 'english text']

   Rekkefølgen er [no, en] — den samme som `LANGS`. Begge MÅ være med;
   tests/i18n.test.js feiler på en rad som mangler et språk, på en nøkkel ingen
   bruker, og på et `{felt}` som bare finnes i det ene språket.

   Tekst med innsatte verdier bruker `{navn}`-felt, aldri strengaddisjon:
   ordstillingen er ikke den samme på de to språkene, så bitene MÅ kunne bytte
   plass inne i oversettelsen.
   ============================================================ */
(function () {
  'use strict';

  // Rekkefølgen her er rekkefølgen i språkvelgeren, og indeksen i ordboken.
  var LANGS = [
    { code: 'no', label: 'Norsk',   html: 'no' },
    { code: 'en', label: 'English', html: 'en' },
  ];
  // Norsk er standard, ikke nettleserens språk: appen har vært norsk for alle
  // som allerede bruker den, og et automatisk bytte ville endret språket under
  // føttene på dem uten at de ba om det. Valget er brukerens — og det ligger
  // både på innloggingsskjermen og i konto-modalen.
  var DEFAULT = 'no';
  var STORAGE_KEY = 'huskis-lang';

  /* ---------------- Ordboken ---------------- */
  var T = {
    /* ==== HUSKIS_I18N_DICT_START ==== */

    /* ---- Felles ---- */
    'common.close':   ['Lukk', 'Close'],
    'common.cancel':  ['Avbryt', 'Cancel'],
    'common.save':    ['Lagre', 'Save'],
    'common.ok':      ['OK', 'OK'],
    'common.back':    ['Tilbake', 'Back'],
    'common.confirm': ['Bekreft', 'Confirm'],
    'common.retry':   ['Prøv igjen', 'Try again'],
    'common.remove':  ['Fjern', 'Remove'],
    'common.done':    ['Ferdig', 'Done'],
    // Anførselstegn rundt et objektnavn — ulike tegn på de to språkene.
    'common.quoted':  ['«{name}»', '“{name}”'],
    'common.unnamed': ['uten navn', 'unnamed'],
    'common.noName':  ['Uten navn', 'Untitled'],
    'common.noNameParen': ['(uten navn)', '(no name)'],

    /* ---- Objekttyper ---- */
    'kind.universe':    ['Område', 'Area'],
    'kind.group':       ['Mappe', 'Folder'],
    'kind.category':    ['Kategori', 'Category'],
    'kind.groupcat':    ['Mappekategori', 'Folder category'],
    // Samme seks typene i bestemt form, slik de leses inne i en setning.
    'kindDef.universe': ['området', 'the area'],
    'kindDef.group':    ['mappen', 'the folder'],
    'kindDef.card':     ['listen', 'the list'],
    'kindDef.item':     ['listepunktet', 'the item'],
    'kindDef.category': ['kategorien', 'the category'],
    'kindDef.groupcat': ['mappekategorien', 'the folder category'],

    /* ---- Toppmeny og breadcrumb ---- */
    'crumb.youAreHere': ['Du er her', 'You are here'],
    'crumb.navTitle':   ['Områder og mapper – bytt, rediger og del',
                         'Areas and folders – switch, edit and share'],
    'nav.titleA':       ['Områder og', 'Areas and'],
    'nav.titleB':       ['mapper', 'folders'],
    'board.newList':    ['Ny liste', 'New list'],

    /* ---- Legg til / meny / redigering ---- */
    'add.group':      ['Legg til mappe', 'Add folder'],
    'add.groupCat':   ['Legg til mappekategori', 'Add folder category'],
    'add.groupInCat': ['Legg til mappe i kategorien', 'Add folder to the category'],
    'add.item':       ['Legg til listepunkt', 'Add item'],
    'add.cat':        ['Legg til kategori', 'Add category'],
    'add.itemInCat':  ['Legg til listepunkt i kategorien', 'Add item to the category'],
    'menu.menu':         ['Meny', 'Menu'],
    'menu.forUniverse':  ['Meny for området', 'Menu for the area'],
    'menu.forGroup':     ['Meny for mappen', 'Menu for the folder'],
    'menu.forGroupCat':  ['Meny for mappekategorien', 'Menu for the folder category'],
    'menu.forCard':      ['Meny for listen', 'Menu for the list'],
    'menu.forItem':      ['Meny for listepunktet', 'Menu for the item'],
    'menu.forCat':       ['Meny for kategorien', 'Menu for the category'],
    'menu.rename':       ['Endre navn', 'Rename'],
    'edit.clickToRename': ['Klikk for å endre navn', 'Click to rename'],
    'edit.clickToEdit':   ['Klikk for å redigere', 'Click to edit'],
    'item.markDone':      ['Merk som gjort', 'Mark as done'],
    'card.done':          ['Utført', 'Done'],
    'card.restoreAllDone': ['Gjenopprett alle utførte listepunkter', 'Restore all completed items'],

    /* ---- Søppelkasse ---- */
    'trash.title':             ['Søppelkasse', 'Trash'],
    'trash.purge':             ['Slett for godt', 'Delete for good'],
    'trash.cards':             ['Slettede lister', 'Deleted lists'],
    'trash.cardsBtnTitle':     ['Slettede lister – trykk for å åpne, hold og sveip for å slette dem for godt',
                                'Deleted lists – tap to open, press and swipe to delete them for good'],
    'trash.universes':         ['Slettede områder', 'Deleted areas'],
    'trash.universesBtnTitle': ['Slettede områder – trykk for å åpne, hold og sveip for å slette dem for godt',
                                'Deleted areas – tap to open, press and swipe to delete them for good'],

    /* ---- Del, flytt, tid, ansvarlig ---- */
    'share.title': ['Del', 'Share'],
    'place.title': ['Flytt listen til', 'Move the list to'],
    'time.edit':   ['Endre tid', 'Edit time'],
    'resp.pick':   ['Velg ansvarlig', 'Choose an assignee'],

    /* ---- Språk ---- */
    'lang.label': ['Språk', 'Language'],
    'lang.aria':  ['Språk i appen og i e-postene', 'Language in the app and in emails'],

    /* ---- Konto ---- */
    'account.title':            ['Konto', 'Account'],
    'account.open':             ['Åpne kontoen', 'Open your account'],
    'account.changePhoto':      ['Endre profilbilde', 'Change profile picture'],
    'account.changePhotoShort': ['Endre bilde', 'Change picture'],
    'account.removePhotoShort': ['Fjern bilde', 'Remove picture'],
    'account.name':             ['Navn', 'Name'],
    'account.namePlaceholder':  ['Fornavn Etternavn', 'First name Last name'],
    'account.email':            ['E-post', 'Email'],
    'account.password':         ['Passord', 'Password'],
    'account.currentPassword':  ['Nåværende passord', 'Current password'],
    'account.newPassword':      ['Nytt passord (minst 6 tegn)', 'New password (at least 6 characters)'],
    'account.emailPrefLabel':   ['Varsle meg på e-post når noe deles med meg',
                                 'Email me when something is shared with me'],
    'account.emailPrefAria':    ['E-postvarsler ved deling', 'Email notifications for sharing'],
    'account.tourLabel':        ['Demonstrasjon av Huskis', 'Huskis demo'],
    'account.tourRestart':      ['Vis på nytt', 'Show again'],
    'account.keyboard':         ['Tastatur', 'Keyboard'],
    'account.keyMove':          ['Flytt det valgte objektet ett hakk', 'Move the selected object one step'],
    'account.keyMoveTo':        ['Flytt til en annen liste, mappe eller område',
                                 'Move to another list, folder or area'],
    'account.keyEsc':           ['Lukk – eller avbryt en navneendring', 'Close – or cancel a rename'],
    'account.invites':          ['Invitasjoner', 'Invitations'],
    'account.logout':           ['Logg ut', 'Sign out'],
    'account.delete':           ['Slett konto', 'Delete account'],
    'account.deleteMsg':        ['Dette sletter kontoen din for godt. Det kan ikke angres.',
                                 'This deletes your account for good. It cannot be undone.'],
    'account.deleteBullet1':    ['Områder du er eneste eier av slettes med alt innholdet — også for dem du har delt med.',
                                 'Areas you are the only owner of are deleted with all their content — for everyone you have shared them with too.'],
    'account.deleteBullet2':    ['Du fjernes fra alt som er delt med deg. Innhold du har laget i andres områder blir stående hos dem.',
                                 'You are removed from everything shared with you. Content you created in other people’s areas stays with them.'],
    'account.deleteBullet3':    ['Navnet ditt, e-postadressen, profilbildet og invitasjonene dine slettes fra databasen.',
                                 'Your name, email address, profile picture and invitations are deleted from the database.'],
    'account.deleteSwipeHint':  ['Sveip helt til høyre for å bekrefte.', 'Swipe all the way right to confirm.'],
    'account.deleteSwipeAria':  ['Sveip helt til høyre for å slette kontoen',
                                 'Swipe all the way right to delete the account'],

    /* ---- Profilbilde ---- */
    'avatar.title':    ['Profilbilde', 'Profile picture'],
    'avatar.hint':     ['Dra bildet for å flytte det. Sirkelen viser hvordan det blir seende ut.',
                        'Drag the picture to move it. The circle shows how it will look.'],
    'avatar.zoom':     ['Zoom', 'Zoom'],
    'avatar.rotation': ['Rotasjon', 'Rotation'],
    'avatar.rotate90': ['Roter 90°', 'Rotate 90°'],
    'avatar.use':      ['Bruk bildet', 'Use this picture'],

    /* ---- Innlogging ---- */
    'auth.login':               ['Logg inn', 'Sign in'],
    'auth.firstName':           ['Fornavn', 'First name'],
    'auth.lastName':            ['Etternavn', 'Last name'],
    'auth.emailPlaceholder':    ['deg@eksempel.no', 'you@example.com'],
    'auth.passwordPlaceholder': ['Minst 6 tegn', 'At least 6 characters'],
    'auth.showPassword':        ['Vis passordet', 'Show password'],
    'auth.hidePassword':        ['Skjul passordet', 'Hide password'],
    'auth.toRegister':          ['Ny bruker? Registrer deg', 'New here? Create an account'],
    'auth.toForgot':            ['Glemt passord?', 'Forgot your password?'],
    'auth.backToLogin':         ['Tilbake til innlogging', 'Back to sign in'],

    /* ---- Demonstrasjonen ---- */
    'tour.progress': ['Framdrift i demonstrasjonen', 'Demo progress'],
    'tour.start':    ['Kom i gang', 'Get started'],
    'tour.close':    ['Avslutt demonstrasjonen', 'End the demo'],

    /* ---- Eksempeldata (kun når skyen ikke er konfigurert) ---- */
    'seed.chores':    ['Ukens gjøremål', 'This week’s chores'],
    'seed.garage':    ['Rydde garasjen', 'Tidy the garage'],
    'seed.dentist':   ['Ringe tannlegen', 'Call the dentist'],
    'seed.flowers':   ['Vanne blomstene', 'Water the flowers'],
    'seed.packing':   ['Pakke til tur', 'Packing for a trip'],
    'seed.raincoat':  ['Regnjakke', 'Rain jacket'],
    'seed.charger':   ['Ladekabel', 'Charging cable'],
    'seed.bottle':    ['Drikkeflaske', 'Water bottle'],
    'seed.map':       ['Kart', 'Map'],
    'seed.ideas':     ['Ideer', 'Ideas'],
    'seed.fence':     ['Male gjerdet', 'Paint the fence'],
    'seed.coffeeBar': ['Prøve ny kaffebar', 'Try the new coffee bar'],
    'seed.groceries': ['Dagligvarer', 'Groceries'],
    'seed.milk':      ['Melk', 'Milk'],
    'seed.bread':     ['Brød', 'Bread'],
    'seed.eggs':      ['Egg', 'Eggs'],
    'seed.butter':    ['Smør', 'Butter'],
    'seed.coffee':    ['Kaffe', 'Coffee'],
    'seed.dinner':    ['Middag i kveld', 'Dinner tonight'],
    'seed.chicken':   ['Kyllingfilet', 'Chicken breast'],
    'seed.rice':      ['Ris', 'Rice'],
    'seed.broccoli':  ['Brokkoli', 'Broccoli'],
    'seed.soy':       ['Soyasaus', 'Soy sauce'],
    'seed.pharmacy':  ['Apotek', 'Pharmacy'],
    'seed.plaster':   ['Plaster', 'Plasters'],
    'seed.sunscreen': ['Solkrem', 'Sunscreen'],

    /* ---- Opplesning (aria-live) ---- */
    'a11y.cannotReorder': ['Kan ikke endre rekkefølgen på {name} her.',
                           'Cannot reorder {name} here.'],
    'a11y.alreadyFirst':  ['{name} står allerede først.', '{name} is already first.'],
    'a11y.alreadyLast':   ['{name} står allerede sist.', '{name} is already last.'],
    'a11y.cannotSwap':    ['Kan ikke bytte plass med {name}.', 'Cannot swap places with {name}.'],
    'a11y.movedUp':       ['{name} flyttet opp til plass {pos} av {total}.',
                           '{name} moved up to position {pos} of {total}.'],
    'a11y.movedDown':     ['{name} flyttet ned til plass {pos} av {total}.',
                           '{name} moved down to position {pos} of {total}.'],
    'a11y.cannotMoveOutOfGroup': ['Du kan ikke flytte {name} ut av denne mappen.',
                                  'You cannot move {name} out of this folder.'],
    'a11y.noOtherGroup':  ['Det finnes ingen annen mappe å flytte {name} til.',
                           'There is no other folder to move {name} to.'],
    'a11y.listLocked':    ['Listen er låst.', 'The list is locked.'],
    'a11y.noOtherListOrCategory': ['Det finnes ingen annen liste eller kategori å flytte til.',
                                   'There is no other list or category to move to.'],
    'a11y.movedToList':   ['Flyttet {name} til listen {dest}.', 'Moved {name} to the list {dest}.'],
    'a11y.movedIntoCategory':  ['Flyttet {name} inn i en kategori.', 'Moved {name} into a category.'],
    'a11y.movedOutOfCategory': ['Flyttet {name} ut av kategorien.', 'Moved {name} out of the category.'],
    'a11y.cannotMoveToOtherUniverse': ['Du kan ikke flytte {name} til et annet område.',
                                       'You cannot move {name} to another area.'],
    'a11y.noOtherUniverse': ['Det finnes ikke noe annet område å flytte til.',
                             'There is no other area to move to.'],
    'a11y.movedToUniverse': ['Flyttet {name} til området {dest}.', 'Moved {name} to the area {dest}.'],
    'a11y.universeIsTop':   ['Et område er øverste nivå og kan ikke flyttes.',
                             'An area is the top level and cannot be moved.'],
    'a11y.categoryCannotMove': ['En kategori kan ikke flyttes til en annen forelder.',
                                'A category cannot be moved to another parent.'],

    /* ---- «Flytt til …» ---- */
    'move.outOfCategory': ['Ut av kategorien (i «{list}»)', 'Out of the category (in “{list}”)'],
    'move.toCategory':    ['Kategorien «{name}»', 'The category “{name}”'],
    'move.toList':        ['Listen «{name}»', 'The list “{name}”'],
    'move.itemPrompt':    ['{name} flyttes dit du velger.', '{name} will be moved where you choose.'],
    'move.groupPrompt':   ['{name} flyttes til området du velger.',
                           '{name} will be moved to the area you choose.'],
    'move.movedTo':       ['Flyttet {name} til {dest}', 'Moved {name} to {dest}'],

    /* ---- Dra og slipp ---- */
    'dnd.listLocked':     ['Listen er låst – du kan ikke flytte noe hit',
                           'The list is locked – you cannot move anything here'],
    'dnd.universeLocked': ['Området er låst – du kan ikke flytte noe hit',
                           'The area is locked – you cannot move anything here'],

    /* ---- Tomtilstander ---- */
    'empty.noGroups':     ['Ingen mapper ennå.', 'No folders yet.'],
    'empty.noGroupsHint': ['Trykk {nav} øverst og deretter {plus} i et område for å komme i gang.',
                           'Tap {nav} at the top, then {plus} inside an area to get started.'],
    'empty.noCards':      ['Ingen lister i {name} ennå.', 'No lists in {name} yet.'],
    'empty.noCardsHint':  ['Trykk {plus} for å komme i gang.', 'Tap {plus} to get started.'],
    'empty.groupLocked':  ['Mappen er låst, så du kan ikke opprette lister i den.',
                           'The folder is locked, so you cannot create lists in it.'],

    /* ---- Seksjonene i nav-modalen ---- */
    'section.mine':             ['Mine områder', 'My areas'],
    'section.sharedUniverses':  ['Områder delt med meg', 'Areas shared with me'],
    'section.sharedGroups':     ['Mapper delt med meg', 'Folders shared with me'],
    'section.freeGroups':       ['Delte mapper', 'Shared folders'],
    'crumb.universeShared':     ['Området er delt', 'The area is shared'],
    'crumb.groupShared':        ['Mappen er delt', 'The folder is shared'],
    'share.withOthers':         ['Delt med andre', 'Shared with others'],
    'share.withYou':            ['Delt med deg', 'Shared with you'],

    /* ---- Nav-modalen ---- */
    'empty.noOwnUniverses':    ['Ingen egne områder ennå.', 'No areas of your own yet.'],
    'empty.noSharedUniverses': ['Ingen områder er delt med deg.', 'No areas have been shared with you.'],
    'nav.newUniverse':         ['Nytt område', 'New area'],
    'nav.newGroup':            ['Ny mappe', 'New folder'],

    /* ---- Presise navn på ikonknapper (aria-label) ---- */
    'label.universe':       ['Området {name}', 'The area {name}'],
    'label.group':          ['Mappen {name}', 'The folder {name}'],
    'label.card':           ['Listen {name}', 'The list {name}'],
    'label.category':       ['Kategorien {name}', 'The category {name}'],
    'label.groupcat':       ['Mappekategorien {name}', 'The folder category {name}'],
    'label.menuUniverse':   ['Meny for området {name}', 'Menu for the area {name}'],
    'label.menuGroup':      ['Meny for mappen {name}', 'Menu for the folder {name}'],
    'label.menuCard':       ['Meny for listen {name}', 'Menu for the list {name}'],
    'label.menuItem':       ['Meny for listepunktet {name}', 'Menu for the item {name}'],
    'label.menuCategory':   ['Meny for kategorien {name}', 'Menu for the category {name}'],
    'label.menuGroupCat':   ['Meny for mappekategorien {name}', 'Menu for the folder category {name}'],
    'label.addGroupIn':     ['Legg til mappe i {name}', 'Add folder to {name}'],
    'label.addGroupCatIn':  ['Legg til mappekategori i {name}', 'Add folder category to {name}'],
    'label.addItemIn':      ['Legg til listepunkt i {name}', 'Add item to {name}'],
    'label.addCatIn':       ['Legg til kategori i {name}', 'Add category to {name}'],
    'label.addGroupInCat':  ['Legg til mappe i kategorien {name}', 'Add folder to the category {name}'],
    'label.addItemInCat':   ['Legg til listepunkt i kategorien {name}', 'Add item to the category {name}'],
    'label.restoreDoneIn':  ['Gjenopprett alle utførte listepunkter i {name}',
                             'Restore all completed items in {name}'],
    'label.markDone':       ['Merk {name} som gjort', 'Mark {name} as done'],
    'label.unmarkDone':     ['Fjern merket gjort på {name}', 'Unmark {name} as done'],

    /* ---- Objektmenyens slett-rader ---- */
    'menu.deleteUniverseForAll': ['Slett området for alle', 'Delete the area for everyone'],
    'menu.deleteGroupForAll':    ['Slett mappen for alle', 'Delete the folder for everyone'],
    'menu.deleteCard':           ['Slett listen', 'Delete the list'],
    'menu.deleteItem':           ['Slett listepunktet', 'Delete the item'],
    'menu.dissolveCategory':     ['Løs opp kategorien', 'Dissolve the category'],
    'menu.dissolveGroupCat':     ['Løs opp mappekategorien', 'Dissolve the folder category'],

    /* ---- Søppelkassene på de andre nivåene ---- */
    'trash.groupsBtnTitle': ['Slettede mapper – trykk for å åpne, hold og sveip for å slette dem for godt',
                             'Deleted folders – tap to open, press and swipe to delete them for good'],
    'trash.groupsCountIn':  ['{count} slettede mapper i {name}', '{count} deleted folders in {name}'],
    'trash.itemsBtnTitle':  ['Slettede listepunkter – trykk for å åpne, hold og sveip for å slette dem for godt',
                             'Deleted items – tap to open, press and swipe to delete them for good'],
    'trash.itemsCountIn':   ['{count} slettede listepunkter i {name}', '{count} deleted items in {name}'],

    /* ---- Forlat en deling ---- */
    'common.theObject': ['objektet', 'the object'],
    'leave.title':   ['Forlat {kind}', 'Leave {kind}'],
    'leave.message': ['Du mister tilgangen til {name}, men innholdet består for de andre.',
                      'You lose access to {name}, but the content stays for everyone else.'],
    'leave.ok':      ['Forlat', 'Leave'],
    'share.groupWithOthers': ['Mappen er delt med andre', 'The folder is shared with others'],
    'share.groupWithYou':    ['Mappen er delt med deg', 'The folder is shared with you'],

    /* ---- Dato og klokkeslett ---- */
    // Tolv forkortede månedsnavn, atskilt med mellomrom, i kalenderrekkefølge.
    'date.monthsShort':  ['jan feb mar apr mai jun jul aug sep okt nov des',
                          'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'],
    'date.dayMonth':     ['{d}. {mon}', '{d} {mon}'],
    'date.dayMonthYear': ['{d}. {mon} {y}', '{d} {mon} {y}'],
    'date.at':           ['{date} kl. {clock}', '{date} at {clock}'],

    /* ---- Indikator-chips ---- */
    'time.startLabel':  ['Start: {time}', 'Start: {time}'],
    'time.dueLabel':    ['Frist: {time}', 'Due: {time}'],
    'chip.tapToChange': ['{text}. Trykk for å endre', '{text}. Tap to change'],
    'resp.label':       ['Ansvarlig: {name}', 'Assignee: {name}'],
    'resp.chosen':      ['Ansvarlig valgt', 'Assignee chosen'],

    /* ---- Antall + objekttype ---- */
    'count.universe.one':   ['{n} område', '{n} area'],
    'count.universe.other': ['{n} områder', '{n} areas'],
    'count.group.one':      ['{n} mappe', '{n} folder'],
    'count.group.other':    ['{n} mapper', '{n} folders'],
    'count.card.one':       ['{n} liste', '{n} list'],
    'count.card.other':     ['{n} lister', '{n} lists'],
    'count.item.one':       ['{n} listepunkt', '{n} item'],
    'count.item.other':     ['{n} listepunkter', '{n} items'],

    'trash.movedOne':  ['Lagt i søppelkassen: {name}', 'Moved to the trash: {name}'],
    'trash.movedMany': ['Lagt i søppelkassen: {what}', 'Moved to the trash: {what}'],
    'move.cardPrompt': ['{name} flyttes til mappen du velger.',
                        '{name} will be moved to the folder you choose.'],
    'dnd.groupNeedsUniverse':    ['En mappe kan ikke flyttes hit — den må ligge i et område',
                                  'A folder cannot be moved here — it has to live in an area'],
    'dnd.cannotCreateGroupHere': ['Du kan ikke opprette mapper i dette området',
                                  'You cannot create folders in this area'],
    'move.otherOwnersTitle': ['Flytte mappen til et område med andre eiere?',
                              'Move the folder to an area with other owners?'],
    'move.otherOwnersMsg':   ['{name} flyttes til et område med andre eiere. De som har tilgang i dag mister den — direkte mappemedlemmer og medeiere følger ikke med. Medlemmene i det nye området får tilgang i stedet.',
                              '{name} will be moved to an area with other owners. Everyone who has access today loses it — direct folder members and co-owners do not come along. The members of the new area get access instead.'],
    'move.otherOwnersOk':    ['Flytt likevel', 'Move anyway'],

    /* ---- Søppelkasse-modalen ---- */
    'trash.note': ['Hent tilbake det du vil beholde. Resten kan du slette for godt — da er det borte. Tips: hold inne søppelkasse-knappen og sveip mot høyre for å slette alt med én gang.',
                   'Restore what you want to keep. The rest you can delete for good — then it is gone. Tip: press and hold the trash button and swipe right to delete everything at once.'],
    'trash.lockedRemains':    ['Låst innhold ligger fortsatt i søppelkassen',
                               'Locked content is still in the trash'],
    'trash.lockedRestore':    ['Låst – du kan ikke hente dette tilbake',
                               'Locked – you cannot restore this'],
    'trash.restoreAria':       ['Gjenopprett {name}', 'Restore {name}'],
    'trash.restoreLockedAria': ['Gjenopprett {name} – låst, du kan ikke hente dette tilbake',
                                'Restore {name} – locked, you cannot restore this'],
    'trash.purgeUniverses': ['Slett områdene for godt', 'Delete the areas for good'],
    'trash.noUniverses':    ['Ingen slettede områder.', 'No deleted areas.'],
    'trash.groupsIn':       ['Slettede mapper – {name}', 'Deleted folders – {name}'],
    'trash.purgeGroups':    ['Slett mappene for godt', 'Delete the folders for good'],
    'trash.noGroups':       ['Ingen slettede mapper.', 'No deleted folders.'],
    'trash.cardsIn':        ['Slettede lister – {name}', 'Deleted lists – {name}'],
    'trash.purgeCards':     ['Slett listene for godt', 'Delete the lists for good'],
    'trash.noCards':        ['Ingen slettede lister.', 'No deleted lists.'],
    'trash.itemsIn':        ['Slettede listepunkter – {name}', 'Deleted items – {name}'],
    'trash.purgeItems':     ['Slett listepunktene for godt', 'Delete the items for good'],
    'trash.noItems':        ['Ingen slettede listepunkter.', 'No deleted items.'],
    'trash.swipeDeleteAll': ['Slett alt', 'Delete all'],
    'resp.none':             ['Ingen ansvarlig', 'No assignee'],
    'share.noMembers':       ['Ingen medlemmer ennå.', 'No members yet.'],
    'share.membersFailed':   ['Fikk ikke hentet medlemmene – prøv igjen',
                              'Could not load the members – try again'],
    'share.loadingMembers':  ['Henter medlemmer …', 'Loading members …'],

    /* ---- Objektmenyen ---- */
    'menu.forObject':   ['Meny for {kind} {name}', 'Menu for {kind} {name}'],
    'menu.responsible': ['Ansvarlig', 'Assignee'],
    'menu.schedule':    ['Tidsplan', 'Schedule'],
    'menu.move':        ['Flytt', 'Move'],
    'menu.moveUp':      ['Flytt opp', 'Move up'],
    'menu.moveDown':    ['Flytt ned', 'Move down'],
    'menu.moveTo':      ['Flytt til …', 'Move to …'],
    'menu.sharing':     ['Deling og medlemmer', 'Sharing and members'],
    'menu.delete':      ['Slett', 'Delete'],

    /* ---- Lås ---- */
    'lock.removeException':      ['Fjern unntaket fra låsen', 'Remove the exception from the lock'],
    'lock.makeException':        ['Gjør unntak fra låsen', 'Make an exception to the lock'],
    'lock.openForEditing':       ['Åpne for redigering', 'Open for editing'],
    'lock.lockForEditing':       ['Lås for redigering', 'Lock for editing'],
    'lock.exemptFromInherited':  ['Unntatt fra en arvet lås', 'Exempt from an inherited lock'],
    'lock.lockedByParent':       ['Låst av en forelder', 'Locked by a parent'],
    'lock.othersCanView':        ['Andre kan se, men ikke redigere', 'Others can view, but not edit'],
    'lock.everyoneCanEdit':      ['Alle med tilgang kan redigere', 'Everyone with access can edit'],

    /* ---- Tidsplan (start/frist) ---- */
    'time.start':           ['Starttid', 'Start'],
    'time.due':             ['Tidsfrist', 'Due'],
    'time.startDate':       ['Startdato', 'Start date'],
    'time.dueDate':         ['Fristdato', 'Due date'],
    'time.datePlaceholder': ['dd.mm.åååå', 'dd/mm/yyyy'],
    'time.clockOptional':   ['Klokkeslett (valgfritt)', 'Time of day (optional)'],
    'time.clear':           ['Fjern tiden', 'Clear the time'],
    'time.clearStart':      ['Fjern starttiden', 'Clear the start time'],
    'time.clearDue':        ['Fjern fristen', 'Clear the due time'],
    'time.controlledBy':    ['Tidene styres av {kind} {name}.', 'The times are controlled by {kind} {name}.'],
    'time.bothOutside':     ['Starttiden og fristen er utenfor tidsrommet.',
                             'The start time and the deadline are outside the time span.'],
    'time.startOutside':    ['Starttiden er utenfor tidsrommet.', 'The start time is outside the time span.'],
    'time.dueOutside':      ['Fristen er utenfor tidsrommet.', 'The deadline is outside the time span.'],
    'time.lockInCard':      ['Lås tidene også til listepunktene i listen',
                             'Apply these times to the items in the list too'],
    'time.lockInCategory':  ['Lås tidene til listepunktene i kategorien',
                             'Apply these times to the items in the category'],
    'account.logoutMsg':        ['Listene dine beholdes på kontoen når du logger ut.',
                                 'Your lists stay on your account when you sign out.'],
    'account.deleteSwipeLabel': ['Slett kontoen', 'Delete the account'],
    'account.deleted':          ['Kontoen din er slettet.', 'Your account has been deleted.'],

    /* ---- Innlogging: moduser, meldinger og feil ---- */
    'auth.register':      ['Registrer deg', 'Create an account'],
    'auth.createAccount': ['Opprett konto', 'Create account'],
    'auth.forgot':        ['Glemt passord', 'Forgot password'],
    'auth.sendLink':      ['Send lenke', 'Send link'],
    'auth.toLogin':       ['Har du konto? Logg inn', 'Already have an account? Sign in'],
    'auth.unavailable':   ['Innlogging er ikke tilgjengelig akkurat nå. Prøv igjen senere.',
                           'Signing in is not available right now. Try again later.'],
    'auth.enterEmail':    ['Skriv inn e-postadressen din.', 'Enter your email address.'],
    'auth.enterFullName': ['Skriv inn både fornavn og etternavn.', 'Enter both your first and last name.'],
    'auth.sentConfirm':   ['Vi har sendt en bekreftelseslenke til {email}. Åpne den for å fullføre registreringen, så kan du logge inn.',
                           'We have sent a confirmation link to {email}. Open it to finish creating your account, then you can sign in.'],
    'auth.sentReset':     ['Hvis {email} har en konto, har vi sendt en lenke for å velge nytt passord. Sjekk innboksen.',
                           'If {email} has an account, we have sent a link for choosing a new password. Check your inbox.'],
    'auth.chooseNewPassword': ['Velg et nytt passord (minst 6 tegn):',
                               'Choose a new password (at least 6 characters):'],
    'auth.inviteSignup':  ['Du er invitert til Huskis! Fullfør registreringen for å bli med.',
                           'You have been invited to Huskis! Finish signing up to join.'],

    'error.generic':               ['Noe gikk galt', 'Something went wrong'],
    'error.badCredentials':        ['Feil e-post eller passord.', 'Wrong email or password.'],
    'error.emailNotConfirmed':     ['E-posten er ikke bekreftet ennå – sjekk innboksen.',
                                    'The email is not confirmed yet – check your inbox.'],
    'error.emailTaken':            ['Denne e-posten er allerede registrert.',
                                    'This email is already registered.'],
    'error.passwordTooShort':      ['Passordet må ha minst 6 tegn.', 'The password must be at least 6 characters.'],
    'error.passwordTooShortShort': ['Passordet må ha minst 6 tegn', 'The password must be at least 6 characters'],
    'error.passwordSameAsOld':     ['Det nye passordet må være et annet enn det gamle.',
                                    'The new password must be different from the old one.'],
    'error.rateLimited':           ['For mange forsøk – vent litt og prøv igjen.',
                                    'Too many attempts – wait a moment and try again.'],

    /* ---- Lagringsstatus og tilgang ---- */
    'sync.saved':         ['Lagret', 'Saved'],
    'sync.saving':        ['Lagrer …', 'Saving …'],
    'sync.offline':       ['Frakoblet – endringene lagres på denne enheten',
                           'Offline – your changes are saved on this device'],
    'sync.rejected':      ['Noen endringer kunne ikke lagres på kontoen din.',
                           'Some changes could not be saved to your account.'],
    'sync.rejectedCache': ['Endringene lagres ikke på denne enheten.',
                           'Changes are not being saved on this device.'],
    'sync.notSaved':      ['Endringen ble ikke lagret. Sjekk forbindelsen og prøv igjen.',
                           'The change was not saved. Check your connection and try again.'],
    'sync.orderNotSaved': ['Den nye rekkefølgen ble ikke lagret – prøv igjen',
                           'The new order was not saved – try again'],
    'access.lostGroup':    ['Du har ikke lenger tilgang til mappen',
                            'You no longer have access to the folder'],
    'access.lostUniverse': ['Du har ikke lenger tilgang til området',
                            'You no longer have access to the area'],

    /* ---- Import av gamle lokale lister ---- */
    'import.title':   ['Legg listene til på kontoen din', 'Add the lists to your account'],
    'import.message': ['Vi fant {what} som ligger lagret på denne enheten. Vil du legge dem til på kontoen din, så du får dem på alle enhetene dine?',
                       'We found {what} stored on this device. Do you want to add them to your account so you have them on all your devices?'],
    'import.ok':      ['Legg til', 'Add'],
    'import.done':    ['Listene ligger nå på kontoen din', 'The lists are now on your account'],
    'import.failed':  ['Listene ble ikke lagt til. Prøv igjen senere.',
                       'The lists were not added. Try again later.'],

    /* ---- Konto: navn, e-post og passord ---- */
    'account.nameEmpty':           ['Navnet kan ikke være tomt.', 'The name cannot be empty.'],
    'account.nameUpdated':         ['Navnet er oppdatert.', 'Your name has been updated.'],
    'account.emailUpdated':        ['E-postadressen er oppdatert.', 'Your email address has been updated.'],
    'account.emailConfirmPending': ['Nesten ferdig – bekreft endringen via lenken vi har sendt på e-post.',
                                    'Almost there – confirm the change using the link we sent by email.'],
    'account.enterCurrentPassword': ['Skriv inn det nåværende passordet.', 'Enter your current password.'],
    'account.newPasswordTooShort':  ['Det nye passordet må ha minst 6 tegn.',
                                     'The new password must be at least 6 characters.'],
    'account.wrongCurrentPassword': ['Feil nåværende passord.', 'Wrong current password.'],
    'account.passwordUpdated':      ['Passordet er oppdatert.', 'Your password has been updated.'],
    'account.passwordUpdatedShort': ['Passordet er oppdatert', 'Your password has been updated'],
    'avatar.readFailed': ['Kunne ikke lese bildefilen', 'Could not read the image file'],
    'avatar.updated':    ['Profilbildet er oppdatert.', 'Your profile picture has been updated.'],
    'avatar.removeTitle': ['Fjern profilbilde', 'Remove profile picture'],
    'avatar.removeMsg':  ['Bildet slettes fra kontoen din, og initialene vises igjen.',
                          'The picture is deleted from your account, and your initials show again.'],
    'avatar.removed':    ['Profilbildet er fjernet.', 'Your profile picture has been removed.'],

    /* ---- Invitasjoner i innboksen ---- */
    'invite.from':        ['fra {from}', 'from {from}'],
    'invite.asOwnerFrom': ['som medeier, fra {from}', 'as co-owner, from {from}'],
    'invite.accept':      ['Godta', 'Accept'],
    'invite.decline':     ['Avslå', 'Decline'],
    'invite.shareAccepted':     ['Deling godtatt', 'Share accepted'],
    'invite.ownershipAccepted': ['Eierskap godtatt', 'Ownership accepted'],

    /* ---- Del-modalen ---- */
    'share.settingsSuffix': [' — Innstillinger for deling', ' — Sharing settings'],
    'share.owner':          ['Eier', 'Owner'],
    'share.coOwners':       ['Medeiere', 'Co-owners'],
    'share.members':        ['Medlemmer', 'Members'],
    'share.ownerUniverse':    ['Eier av området', 'Owner of the area'],
    'share.coOwnersUniverse': ['Medeiere av området', 'Co-owners of the area'],
    'share.ownerGroup':       ['Eier av mappen', 'Owner of the folder'],
    'share.coOwnersGroup':    ['Medeiere av mappen', 'Co-owners of the folder'],
    'share.membersUniverse':  ['Medlemmer av området', 'Members of the area'],
    'share.membersGroup':     ['Medlemmer av mappen', 'Members of the folder'],
    'share.invitePlaceholder': ['E-post å invitere', 'Email to invite'],
    'share.inviteAria':        ['E-postadresse å invitere', 'Email address to invite'],
    'share.roleAria':          ['Rolle for den inviterte', 'Role for the invitee'],
    'share.asMember':          ['Som medlem', 'As member'],
    'share.asCoOwner':         ['Som medeier', 'As co-owner'],
    'share.asCoOwnerGroup':    ['Som medeier av mappen', 'As co-owner of the folder'],
    'share.invite':            ['Inviter', 'Invite'],
    'share.inviteSent':        ['Invitasjon sendt til {email}', 'Invitation sent to {email}'],
    'share.policyLabel': ['Tillat andre medlemmer å invitere folk til {kind}',
                          'Let other members invite people to {kind}'],
    'share.policyOn':    ['Andre medlemmer kan invitere folk hit.', 'Other members can invite people here.'],
    'share.policyOff':   ['Bare eiere kan invitere folk hit.', 'Only owners can invite people here.'],
    'share.you':         ['{name} (deg)', '{name} (you)'],
    'share.roleOwner':   ['Eier', 'Owner'],
    'share.roleMember':  ['Medlem', 'Member'],
    'share.promote':     ['Gjør til medeier', 'Make co-owner'],
    'share.promoteTitle': ['Invitere til medeierskap', 'Invite to co-ownership'],
    'share.promoteMsg':  ['{name} får en invitasjon til å bli medeier av {kind}. Eierskapet gjelder først når invitasjonen er godtatt, og en medeier har de samme rettighetene som deg.',
                          '{name} will get an invitation to become a co-owner of {kind}. The ownership only takes effect once the invitation is accepted, and a co-owner has exactly the same rights as you.'],
    'share.promoteOk':   ['Send invitasjon', 'Send invitation'],
    'share.promoteSent': ['Invitasjon til medeierskap sendt til {name}.',
                          'Co-ownership invitation sent to {name}.'],
    'share.demote':      ['Gjør til medlem', 'Make member'],
    'share.demoteTitle': ['Fjerne medeierskap', 'Remove co-ownership'],
    'share.demoteMsg':   ['{name} blir vanlig medlem og mister eier-rettighetene.',
                          '{name} becomes an ordinary member and loses the owner rights.'],
    'share.stepDown':    ['Tre av som medeier', 'Step down as co-owner'],
    'share.stepDownOk':  ['Tre av', 'Step down'],
    'share.stepDownMsg': ['Du blir vanlig medlem og mister eier-rettighetene. Du beholder tilgangen, men kan ikke lenger administrere medlemmer, lås eller sletting.',
                          'You become an ordinary member and lose the owner rights. You keep your access, but can no longer manage members, locks or deletion.'],
    'share.removeMemberTitle': ['Fjerne medlem', 'Remove member'],
    'share.removeMemberMsg':   ['Fjerne {name} fra {kind}? All tilgang under det forsvinner også.',
                                'Remove {name} from {kind}? All access below it disappears too.'],
    'share.pendingInvites':  ['Ventende invitasjoner', 'Pending invitations'],
    'share.invitedAsOwner':  ['Invitert som medeier', 'Invited as co-owner'],
    'share.invitedAsMember': ['Invitert som medlem', 'Invited as member'],
    'share.withdraw':        ['Trekk tilbake', 'Withdraw'],
    'share.deleteForAllLabel': ['Slett {kind} for alle', 'Delete {kind} for everyone'],
    'share.deleteForAll':      ['Slett for alle', 'Delete for everyone'],
    'share.deleteForAllMsg':   ['Dette sletter {kind} og alt innholdet for ALLE med tilgang.',
                                'This deletes {kind} and all its content for EVERYONE with access.'],
    'share.onlyOwnerNote':     ['Du er eneste eier. Gi eierskap til noen andre før du kan forlate området.',
                                'You are the only owner. Give ownership to someone else before you can leave the area.'],
    'leave.messageShort':      ['Du mister tilgangen, men innholdet består for de andre.',
                                'You lose your access, but the content stays for everyone else.'],

    /* ---- Låsetilstand i del-modalen ---- */
    'lock.lockedForEditing':     ['Låst for redigering', 'Locked for editing'],
    'lock.openForEditingState':  ['Åpent for redigering', 'Open for editing'],
    'lock.lockNow':              ['Lås nå', 'Lock now'],
    'lock.openNow':              ['Åpne nå', 'Open now'],
    'lock.exceptionLabel':       ['Unntak: andre kan redigere {kind}',
                                  'Exception: others can edit {kind}'],
    'lock.autoLocked':           ['Automatisk låst for redigering', 'Automatically locked for editing'],
    'lock.becausePrefix':        ['Fordi ', 'Because '],
    'lock.isLocked':             [' er låst', ' is locked'],
    'lock.isLockedExempt':       [' er låst — denne er unntatt', ' is locked — this one is exempt'],
    'lock.removeExceptionShort': ['Fjern unntak', 'Remove exception'],
    'lock.makeExceptionShort':   ['Gjør unntak', 'Make exception'],

    /* ---- Demonstrasjonen (stegene) ----
       `{list}`, `{folder}`, `{globe}` og `{category}` er ikoner (SVG-markup)
       som settes inn i teksten — de skal stå der de gir mening i setningen. */
    'tour.welcomeTitle': ['Velkommen til Huskis', 'Welcome to Huskis'],
    'tour.welcome': ['<p>Her kan du lage</p><ul class="tour-list"><li>{list}<span><b>huskelister</b> for å holde styr på livet ditt</span></li><li>{folder}<span><b>mapper</b> for å holde styr på listene dine</span></li><li>{globe}<span><b>områder</b> for å holde styr på mappene dine</span></li></ul><p>Innad i listene kan listepunktene sorteres i {category} <b>kategorier</b> – hvis du vil.</p>',
                     '<p>Here you can make</p><ul class="tour-list"><li>{list}<span><b>lists</b> to keep track of your life</span></li><li>{folder}<span><b>folders</b> to keep track of your lists</span></li><li>{globe}<span><b>areas</b> to keep track of your folders</span></li></ul><p>Inside a list, the items can be sorted into {category} <b>categories</b> – if you like.</p>'],
    'tour.welcomeNote': ['Nå får du en guidet tur gjennom appens viktigste funksjoner.',
                         'You are about to get a guided tour of what the app can do.'],
    'tour.openNav': ['<p>Denne knappen viser {globe} <b>området</b> og {folder} <b>mappen</b> du er i.</p><p>Trykk på den for å komme til oversikten der du oppretter områder og mapper.</p>',
                     '<p>This button shows the {globe} <b>area</b> and the {folder} <b>folder</b> you are in.</p><p>Tap it to open the overview where you create areas and folders.</p>'],
    'tour.createArea': ['<p>Trykk på denne knappen for å opprette et {globe} <b>område</b>.</p>',
                        '<p>Tap this button to create an {globe} <b>area</b>.</p>'],
    'tour.nameArea': ['<p>Gi området et navn.</p><p>Bekreft med <span class="hint-chip">Enter</span>-tasten eller ved å klikke utenfor navnefeltet.</p>',
                      '<p>Give the area a name.</p><p>Confirm with the <span class="hint-chip">Enter</span> key, or by clicking outside the name field.</p>'],
    'tour.createFolder': ['<p>Trykk på den grønne knappen for å opprette en {folder} <b>mappe</b>.</p>',
                          '<p>Tap the green button to create a {folder} <b>folder</b>.</p>'],
    'tour.nameFolder': ['<p>Gi mappen et navn.</p>', '<p>Give the folder a name.</p>'],
    'tour.openFolder': ['<p>Trykk på feltet til mappen du nettopp opprettet for å navigere til mappen.</p>',
                        '<p>Tap the row of the folder you just made to go into it.</p>'],
    'tour.createList': ['<p>Trykk her for å opprette en {list} <b>liste</b>.</p>',
                        '<p>Tap here to create a {list} <b>list</b>.</p>'],
    'tour.nameList': ['<p>Gi listen et navn.</p>', '<p>Give the list a name.</p>'],
    'tour.createItem': ['<p>Trykk her for å opprette et <b>listepunkt</b>.</p>',
                        '<p>Tap here to create an <b>item</b>.</p>'],
    'tour.nameItem': ['<p>Gi listepunktet et navn.</p>', '<p>Give the item a name.</p>'],
    'tour.createItem2': ['<p>Opprett et listepunkt til.</p>', '<p>Create one more item.</p>'],
    'tour.dragItem': ['<p>Trekk det nederste listepunktet oppover for å endre rekkefølgen på listepunktene.</p><p>Hold fingeren (eller museknappen) inne på punktet til det løfter seg, og dra.</p>',
                      '<p>Drag the bottom item upwards to change the order of the items.</p><p>Press and hold on the item (finger or mouse button) until it lifts, then drag.</p>'],
    'tour.createList2': ['<p>Opprett en liste til.</p>', '<p>Create one more list.</p>'],
    'tour.nameList2': ['<p>Gi den nye listen et navn.</p>', '<p>Give the new list a name.</p>'],
    'tour.dragList': ['<p>Trekk listen du nettopp lagde forbi den andre for å bytte rekkefølge på de to listene.</p><p>Ta tak i listens overskrift, hold inne, og dra.</p>',
                      '<p>Drag the list you just made past the other one to swap the order of the two.</p><p>Grab the list by its heading, press and hold, then drag.</p>'],
    'tour.createCat': ['<p>Trykk på den gule knappen for å opprette en {category} <b>kategori</b> i listen.</p>',
                       '<p>Tap the yellow button to create a {category} <b>category</b> in the list.</p>'],
    'tour.nameCat': ['<p>Gi kategorien et navn.</p>', '<p>Give the category a name.</p>'],
    'tour.dragIntoCat': ['<p>Trekk et listepunkt inn i kategorien.</p>', '<p>Drag an item into the category.</p>'],
    'tour.createCatItem': ['<p>Opprett et listepunkt direkte i kategorien med ＋-knappen inne i den.</p>',
                           '<p>Create an item straight inside the category with the ＋ button in it.</p>'],
    'tour.nameCatItem': ['<p>Gi listepunktet et navn.</p>', '<p>Give the item a name.</p>'],
    'tour.dissolveCat': ['<p>Åpne menyen på kategorien og velg «Løs opp kategorien». Listepunktene blir stående der de er — bare overskriften forsvinner.</p>',
                         '<p>Open the menu on the category and choose “Dissolve the category”. The items stay where they are — only the heading disappears.</p>'],
    'tour.deleteItem': ['<p>Hvert objekt har én menyknapp til høyre. Åpne menyen på et listepunkt og velg «Slett listepunktet».</p><p>Du kan også dra objektet rett i søppelkassen — den dukker opp så snart du løfter noe.</p>',
                        '<p>Every object has one menu button on the right. Open the menu on an item and choose “Delete the item”.</p><p>You can also drag the object straight into the trash — it appears as soon as you lift something.</p>'],
    'tour.openItemTrash': ['<p>Trykk på søppelkassen nederst i listen for å se hva som ligger i den.</p>',
                           '<p>Tap the trash at the bottom of the list to see what is in it.</p>'],
    'tour.restoreItem': ['<p>Gjenopprett listepunktet.</p>', '<p>Restore the item.</p>'],
    'tour.closeItemTrash': ['<p>Lukk søppelkassen.</p>', '<p>Close the trash.</p>'],
    'tour.deleteItem2': ['<p>Slett et listepunkt igjen.</p>', '<p>Delete an item once more.</p>'],
    'tour.emptyItemTrash': ['<p>Tøm søppelkassen: hold inne knappen og sveip til høyre.</p><p>Da er listepunktet borte for godt.</p>',
                            '<p>Empty the trash: press and hold the button, then swipe right.</p><p>Now the item is gone for good.</p>'],
    'tour.deleteList': ['<p>Slett listen fra menyen i korthodet.</p>',
                        '<p>Delete the list from the menu in its heading.</p>'],
    'tour.emptyCardTrash': ['<p>Tøm mappens søppelkasse: hold inne knappen i toppmenyen og sveip til høyre.</p>',
                            '<p>Empty the folder’s trash: press and hold the button in the top bar, then swipe right.</p>'],
    'tour.openNav2': ['<p>Gå til «Områder og mapper».</p>', '<p>Go to “Areas and folders”.</p>'],
    'tour.deleteArea': ['<p>Slett området fra menyen i korthodet. Mappen og alt i den følger med.</p>',
                        '<p>Delete the area from the menu in its heading. The folder and everything in it goes too.</p>'],
    'tour.emptyUniTrash': ['<p>Tøm områdenes søppelkasse: hold inne knappen og sveip til høyre.</p>',
                           '<p>Empty the areas’ trash: press and hold the button, then swipe right.</p>'],
    'tour.closeNav': ['<p>Da er alt ryddet bort igjen. Lukk oversikten.</p>',
                      '<p>That clears everything away again. Close the overview.</p>'],
    'tour.finishTitle': ['Takk for turen!', 'Thanks for coming along!'],
    'tour.finish': ['<p>Turen er over, og du er nå i din egen Huskis. Du kan ta turen igjen ved å gå til kontosiden din.</p>',
                    '<p>The tour is over, and you are now in your own Huskis. You can take it again from your account page.</p>'],
    'tour.typeNameHint': ['Skriv navnet og trykk Enter.', 'Type the name and press Enter.'],

    /* ---- Kontekstuelle tips ---- */
    'tip.drag':      ['Tips: hold på en tittel for å flytte den.',
                      'Tip: press and hold a heading to move it.'],
    'tip.trash':     ['Tips: hold på søppelkassen og sveip for å slette alt i den.',
                      'Tip: press and hold the trash, then swipe to delete everything in it.'],
    'tip.moveList':  ['Tips: dra en liste opp på navigasjonsknappen for å flytte den.',
                      'Tip: drag a list onto the navigation button to move it.'],
    'tip.dragTrash': ['Tips: dra et objekt i søppelkassen for å slette det.',
                      'Tip: drag an object into the trash to delete it.'],
    'tip.gotIt':     ['Skjønner', 'Got it'],

    /* ---- Automatisk klientoppdatering (update-check.js) ---- */
    'update.available': ['En ny versjon av Huskis er tilgjengelig.', 'A new version of Huskis is available.'],
    'update.waiting':   ['Siden oppdateres når endringene dine er lagret.',
                         'The page will update once your changes are saved.'],
    'update.now':       ['Oppdater nå', 'Update now'],
    'share.removeHintInherited': ['Har tilgang via området og må fjernes der',
                                  'Has access through the area and must be removed there'],
    'share.removeHintLastOwner': ['Siste eier kan ikke fjernes', 'The last owner cannot be removed'],
    'lang.notOnAccount': ['Språket er endret på denne enheten, men kunne ikke lagres på kontoen din.',
                          'The language was changed on this device, but could not be saved to your account.'],
    'lang.notStored':    ['Språket er endret, men denne enheten kan ikke huske valget.',
                          'The language was changed, but this device cannot remember the choice.'],
    /* ==== HUSKIS_I18N_DICT_END ==== */
  };

  /* ---------------- Kjøretid ---------------- */

  function entry(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
    return null;
  }
  // Alt ukjent (null, en gammel verdi, noe en annen fane skrev) blir standarden:
  // språket er en visningsdetalj, og skal aldri kunne velte oppstarten.
  function normalize(code) { return entry(code) ? code : DEFAULT; }

  var current = DEFAULT;
  var explicit = false;   // har enheten et valg brukeren faktisk har tatt?
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    explicit = !!entry(saved);
    current = normalize(saved);
  } catch (e) { /* privat modus */ }

  function lang() { return current; }
  // Har enheten et valg BRUKEREN har tatt, eller står den bare på standarden?
  // Forskjellen avgjør om valget skal løftes opp på kontoen ved innlogging.
  function chosen() { return explicit; }

  /* Setter språket for DENNE fanen: `<html lang>` + den lagrede verdien.
     Rendrer IKKE på nytt — den som bytter språk laster appen på nytt (app.js →
     setLanguage()), som er det eneste som garantert treffer hver eneste tekst.

     RETURNERER om valget faktisk ble LAGRET. Det er avgjørende for kalleren:
     i privat modus (eller med blokkerte nettsteddata) kaster `setItem`, og da
     starter en omlasting på standardspråket igjen. Kombinert med en konto som
     står på et annet språk ville det gitt en evig omlastingsløkke — appen kom
     aldri opp. Kalleren bytter derfor i minnet i stedet når dette er `false`. */
  function setLang(code) {
    current = normalize(code);
    explicit = true;
    var saved = false;
    try { localStorage.setItem(STORAGE_KEY, current); saved = true; } catch (e) { /* privat modus */ }
    applyHtmlLang();
    return saved;
  }

  function applyHtmlLang() {
    var e = entry(current) || LANGS[0];
    if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', e.html);
  }

  /* Slår opp en tekst. Ukjent nøkkel gir nøkkelen tilbake — synlig i UI-et,
     men ikke en krasj; tests/i18n.test.js er det som stopper den før den når
     noen. `vars` fyller `{felt}`. */
  function t(key, vars) {
    var row = T[key];
    var s = row ? (row[current === 'en' ? 1 : 0] || row[0]) : key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
    });
  }

  /* Statisk tekst i index.html. Attributtene sier hvor teksten skal:

       data-i18n              → textContent
       data-i18n-html         → innerHTML (kun tekst vi selv eier, aldri brukerinput)
       data-i18n-title        → title
       data-i18n-aria-label   → aria-label
       data-i18n-placeholder  → placeholder

     Kjøres én gang ved oppstart. Maler (`<template>`) må kjøres gjennom hver
     gang en klon bygges — app.js gjør det i `fromTemplate()`. */
  var ATTRS = [
    ['data-i18n-title', 'title'],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-placeholder', 'placeholder'],
  ];
  function translateEl(el) {
    var key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
    key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
    for (var a = 0; a < ATTRS.length; a++) {
      key = el.getAttribute(ATTRS[a][0]);
      if (key) el.setAttribute(ATTRS[a][1], t(key));
    }
  }
  function applyStatic(root) {
    var scope = root || document;
    // `querySelectorAll` treffer bare etterkommere — en klonet malrot bærer
    // ofte attributtene selv, og må derfor oversettes for seg.
    if (scope.nodeType === 1) translateEl(scope);
    var list = scope.querySelectorAll(
      '[data-i18n],[data-i18n-html],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder]');
    for (var i = 0; i < list.length; i++) translateEl(list[i]);
    // Malene (`<template>`) ligger i document, men innholdet deres er et eget
    // fragment `querySelectorAll` ikke går inn i: de oversettes når app.js
    // kloner dem, ikke her.
    return scope;
  }

  applyHtmlLang();

  window.HUSKIS_I18N = {
    LANGS: LANGS,
    DEFAULT: DEFAULT,
    STORAGE_KEY: STORAGE_KEY,
    T: T,
    t: t,
    lang: lang,
    chosen: chosen,
    setLang: setLang,
    applyStatic: applyStatic,
  };
})();
