import { APP_NAME, APP_TAGLINE } from '../config';

/**
 * Every piece of interface text, in one place. The wording follows the original game
 * (`res/values/strings.xml` of the Android port) wherever the screen exists there.
 */
export const STRINGS = {
  splashCredit: 'Based on Gravity Defied\n© 2004 Codebrew Software\nAndroid port by G. Klyushnikov and E. Zinoviev',

  main: 'Main',
  mods: 'Mods',
  myRuns: 'My runs',
  daily: 'Daily track',
  dailyUnavailable: 'The daily track could not be loaded. Check the connection and try again.',
  dailyBest: 'Your best today',
  dailyNotYet: 'not finished yet',
  dailyStreak: 'Days in a row',
  dailyDays: (days: number) => String(days),
  dailyNewBest: 'Your best today!',
  editor: 'Editor',
  editorNew: 'New track',
  editorNewName: (number: number) => `My track ${number}`,
  editorCopy: (name: string) => `Copy "${name}"`,
  editorCannotCopy: 'This track is too large or too small to edit.',
  editorUnnamed: '(no name)',
  editorPlay: 'Play my tracks',
  editorSave: 'Save levels.mrg',
  editorEdit: 'Edit',
  editorDelete: 'Delete track',
  editorDeleteConfirmation: 'Are you sure you want to delete this track? This action cannot be undone.',
  editorPoints: (count: number) => `${count} points`,
  editorName: 'Track name',
  editorAdd: 'Add',
  editorRemove: 'Delete',
  editorUndo: 'Undo',
  editorRedo: 'Redo',
  editorTest: 'Test',
  editorDone: 'Done',
  editorStart: 'Start',
  editorFinish: 'Finish',
  editorHint: 'Drag points, the start and the finish. Double-click to add a point. Scroll or pinch to zoom.',
  editorAddHint: 'Click where the new point should be.',
  editorTooFew: 'A track needs at least three points.',
  editorTestHint: 'Test drive. Esc returns to the editor.',
  editorTestFinished: (time: string) => `Finished in ${time}.`,
  editorTestFailed: 'The game cannot ride this track as it is.',
  myTracks: 'My tracks',
  watch: 'Watch',
  race: 'Race this run',
  share: 'Share',
  copyLink: 'Copy link',
  shareVia: 'Share via..',
  saveFile: 'Save replay file',
  saveImage: 'Save image',
  saveSquareImage: 'Save square image',
  copyImage: 'Copy image',
  saveGif: 'Save GIF',
  imageSaved: 'Image saved.',
  imageCopied: 'Image copied.',
  gifRendering: (percent: number) => `Rendering the GIF.. ${percent}%`,
  gifSaved: (megabytes: string) => `GIF saved (${megabytes} MB).`,
  exportFailed: 'That did not work in this browser.',
  openReplayFile: 'Open replay file',
  openingReplay: 'Opening the replay..',
  ownLevels: 'Own levels',
  linkCopied: (length: number) => `Link copied (${length} characters).`,
  linkLong: 'This link is long and some apps may cut it. The file is the safer way to send this run.',
  linkNotCopied: 'The link could not be copied here. Save the file instead.',
  shareText: (track: string, result: string) => `${track} - ${result} - Wheelie!`,
  watchReplay: 'Watch replay',
  playerPlay: 'Play',
  playerPause: 'Pause',
  playerClose: 'Close',
  playerTimeline: 'Position in the replay',
  replayNoPack: 'The levels this run was made on are not installed.',
  replayChangedTrack: 'The track has changed since this run was made.',
  replayOtherVersion: 'This run was recorded with another version of the game and cannot be played back.',
  replayDamaged: 'This replay cannot be read.',
  noRuns: 'No runs yet. Every run you make is recorded here.',
  runCrashed: 'crashed',
  runAbandoned: 'not finished',
  result: 'Result',
  levels: 'Levels',
  rider: 'Rider',
  date: 'Date',
  downloadMods: 'Download mods',
  installedMods: 'Installed mods',
  installMrg: 'Install levels.mrg',
  downloading: 'Downloading..',
  installing: 'Installing..',
  downloadError: 'Cannot download levels list.',
  downloadInterrupted: 'Downloading was interrupted',
  sortBy: 'Sort by',
  sortOrders: ['Popularity', 'Most recent', 'Oldest', 'Tracks count'],
  loadMore: (left: number) => `Load more (${left})`,
  author: 'Author',
  unknownAuthor: 'unknown',
  added: 'Added',
  tracks: 'Tracks',
  installed: 'Installed',
  active: 'active',
  activeText: 'You are playing these levels.',
  installKb: (size: number) => `Install (${size} Kb)`,
  openInstalled: 'Open installed',
  playThese: 'Play these levels',
  successfullyInstalled: 'Levels successfully installed.',
  damagedPack: 'Looks like these levels are damaged.',
  delete: 'Delete',
  deleteLevels: 'Delete levels',
  deleteLevelsConfirmation: 'Are you sure you want to delete these levels? This action cannot be undone.',
  originalLevels: 'Original levels',
  playMenu: 'Play Menu',
  play: 'Play',
  options: 'Options',
  help: 'Help',
  about: 'About',
  back: 'Back',
  ok: 'Ok',
  yes: 'Yes',
  no: 'No',
  on: 'On',
  off: 'Off',
  goToMain: 'Go to Main',

  start: 'Start',
  level: 'Level',
  track: 'Track',
  league: 'League',
  highscores: 'High Scores',
  noHighscores: 'No Highscores',
  completeToUnlock: 'Complete more tracks to unlock this track/league combo.',
  damagedTrack: 'Looks like this level is damaged.',

  ingame: 'Ingame',
  continue: 'Continue',
  restart: 'Restart',
  next: 'Next',

  finished: 'Finished!',
  places: ['First place!', 'Second place!', 'Third place!'],
  time: 'Time',
  name: 'Name',
  enterName: 'Enter Name',
  congratulations: 'Congratulations! You have successfully unlocked a new league: ',
  enjoy: 'Enjoy...',
  leagueUnlocked: 'League unlocked',
  leagueUnlockedText: 'You have successfully unlocked a new league: ',
  levelCompleted: 'You have completed all tracks at this level.',
  tracksCompleted: (done: number, total: number, level: string) =>
    `${done} of ${total} tracks in <b>${level}</b> completed.`,

  perspective: 'Perspective',
  shadows: 'Shadows',
  driverSprite: 'Driver sprite',
  bikeSprite: 'Bike sprite',
  input: 'Input',
  keysets: ['Keyset 1', 'Keyset 2', 'Keyset 3'],
  lookAhead: 'Look ahead',
  vibrateOnTouch: 'Vibrate on touch',
  keyboardInMenu: 'Keyboard in menu',
  ghost: 'Ghost',
  music: 'Music',
  sound: 'Sound',
  clearHighscore: 'Clear highscore',
  fullReset: 'Full Reset',
  confirmClear: 'Confirm Clear',
  confirmReset: 'Confirm Reset',
  cleared: 'Cleared',
  clearedText: 'Highscores have been cleared',
  eraseText1: 'Clearing the highscores cannot be undone. It will remove all the registered times on all tracks.',
  eraseText2: 'Would you like to clear the highscores?',
  resetText1:
    'A full reset cannot be undone. It will relock all tracks and leagues and clear back all settings to default. A full reset will restart the game.',
  resetText2: 'Would you like to do a full reset?',

  objective: 'Objective',
  objectiveText:
    "Race to the finish line as fast as you can without crashing. By leaning forward and backward you can adjust the rotation of your bike. By landing on both wheels after jumping, your bike won't crash as easily. Beware, the levels tend to get harder and harder...",
  keys: 'Keys',
  keysText: `<b>Keyboard</b><br>
Up or W accelerates, Down or S brakes, Right or D leans forward and Left or A leans backward. Esc pauses.<br><br>
<b>Gamepad</b><br>
Right trigger or the bottom face button accelerates, left trigger or the left face button brakes. The left stick, the d-pad or the bumpers lean. Start pauses.<br><br>
<b>Keyset 1</b><br>
2 accelerates, 8 brakes, 6 leans forward and 4 leans backward. 1 accelerates and leans backward. 3 accelerates and leans forward. 7 brakes and leans backward. 9 brakes and leans forward.<br><br>
<b>Keyset 2</b><br>
1 accelerates, 4 brakes, 6 leans forward and 5 leans backward.<br><br>
<b>Keyset 3</b><br>
3 accelerates, 6 brakes, 5 leans forward and 4 leans backward.<br><br>
The keysets apply to the digit keys and to the on-screen keypad, whose buttons stand for the digits 1 to 9.`,
  unlocking: 'Unlocking',
  unlockingText:
    'By completing the easier levels, new levels will be unlocked. You will also gain access to higher leagues where more advanced bikes with different characteristics are available.',
  highscoreText:
    'The three best times on every track are saved for each league. When beating a time on a track you will be asked to enter your name. The highscores can be viewed from the Play Menu. By pressing left and right in the highscore view you can view the highscore for a specific league. The highscore can be cleared from the options menu.',
  optionsText: `<b>Perspective: On/Off</b><br>Default: &lt;On&gt;<br>Turns on and off the perspective view of the tracks.<br><br>
<b>Shadows: On/Off</b><br>Default: &lt;On&gt;<br>Turns on and off the shadows.<br><br>
<b>Driver Sprite: On/Off</b><br>Default: &lt;On&gt;<br>&lt;On&gt; uses a texture for the driver. &lt;Off&gt; uses line graphics.<br><br>
<b>Bike Sprite: On/Off</b><br>Default: &lt;On&gt;<br>&lt;On&gt; uses a texture for the bike. &lt;Off&gt; uses line graphics.<br><br>
<b>Input: Keyset 1,2,3</b><br>Default: &lt;1&gt;<br>Determines which type of input should be used when playing. See "Keys" in the help menu for more info.<br><br>
<b>Look ahead: On/Off</b><br>Default: &lt;On&gt;<br>Turns on and off smart camera movement.<br><br>
<b>Vibrate on touch: On/Off</b><br>Default: &lt;On&gt;<br>Enables haptic feedback when you press the on-screen keys.<br><br>
<b>Keyboard in menu: On/Off</b><br>Default: &lt;On&gt;<br>Turns on and off the on-screen keyboard in menus.<br><br>
<b>Ghost: On/Off</b><br>Default: &lt;On&gt;<br>Shows your fastest run on the track as a faint bike to race against, with the gap to it under the clock.<br><br>
<b>Music: On/Off</b><br>Default: &lt;On&gt;<br>Turns the background music on and off.<br><br>
<b>Sound: On/Off</b><br>Default: &lt;On&gt;<br>Turns the engine and the sound effects on and off.<br><br>
<b>Clear highscore</b><br>Lets you clear the highscores. Here you can also do a "Full Reset" which will reset the game to its original state (clear settings, highscores, unlocked levels and leagues).`,
  aboutText: `<b>${APP_NAME}</b><br>${APP_TAGLINE}.<br><br>
This is a fan project. It is not affiliated with, endorsed by or connected to Codebrew Software. All rights to the original Gravity Defied, its name, logo, brand and original assets belong to Codebrew Software.<br><br>
<b>Gravity Defied - Trial Racing</b> by Codebrew Software<br>codebrew.se &copy; 2004<br><br>
<b>Gravity Defied Classic</b> for Android by Gregory Klyushnikov and Evgeny Zinoviev<br>gdtr.net &copy; 2014<br><br>
<b>Level packs</b> in the Mods menu were made by the gdtr.net community; each one shows its author.<br><br>
<b>Music</b>: "Go" by Abstraction, from the album Three Red Hearts (public domain)<br><br>
Source code, under the GNU GPL v2:<br>github.com/MihailPreis/Wheelie`,

  crashed: 'Crashed',
  wheelie: 'Wheelie!',
  finishedMessage: 'Finished',
} as const;
