/**
 * OPTIMIZED EnergyTech Quiz App Backend
 * Performance improvements:
 * 1. Efficient range queries instead of full-sheet loads
 * 2. Map-based lookups for O(1) access instead of O(n) iteration
 * 3. Reduced ensureHeaders_() calls on critical path
 * 4. Batch operations where possible
 * 5. Caching for frequently accessed data
 */

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

const CACHE_CONFIG = {
  TTL_ITEMS: 300000,      // 5 minutes for items
  TTL_GROUPS: 300000,     // 5 minutes for groups
  TTL_TRAINEES: 300000,   // 5 minutes for trainees
};

const cache_ = {
  items: { data: null, timestamp: null },
  groups: { data: null, timestamp: null },
  trainees: { data: null, timestamp: null },
  sheetInit: false,
};

function isValidCache_(cacheKey) {
  const entry = cache_[cacheKey];
  if (!entry || !entry.data) return false;

  const age = Date.now() - entry.timestamp;
  const ttl = CACHE_CONFIG['TTL_' + cacheKey.toUpperCase()] || 300000;

  return age < ttl;
}

function getCache_(cacheKey) {
  if (isValidCache_(cacheKey)) {
    return cache_[cacheKey].data;
  }
  return null;
}

function setCache_(cacheKey, data) {
  cache_[cacheKey] = {
    data: data,
    timestamp: Date.now()
  };
}

function clearCache_() {
  cache_.items = { data: null, timestamp: null };
  cache_.groups = { data: null, timestamp: null };
  cache_.trainees = { data: null, timestamp: null };
}

// ============================================================================
// INITIALIZATION (Only run once on deployment)
// ============================================================================

function onInstall() {
  // Run header setup once, mark as initialized
  ensureSheets_();
  PropertiesService.getDocumentProperties().setProperty('sheets_initialized', 'true');
}

function ensureSheets_() {
  if (cache_.sheetInit) return;

  // Get or create all sheets
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Ensure all sheets exist
  attemptsSheet = ss.getSheetByName('Attempts') || ss.insertSheet('Attempts');
  sessionsSheet = ss.getSheetByName('Sessions') || ss.insertSheet('Sessions');
  itemsSheet = ss.getSheetByName('Items') || ss.insertSheet('Items');
  itemResponsesSheet = ss.getSheetByName('ItemResponses') || ss.insertSheet('ItemResponses');
  traineesSheet = ss.getSheetByName('Trainees') || ss.insertSheet('Trainees');
  instructorsSheet = ss.getSheetByName('Instructors') || ss.insertSheet('Instructors');
  intakesSheet = ss.getSheetByName('Intakes') || ss.insertSheet('Intakes');
  groupsSheet = ss.getSheetByName('Groups') || ss.insertSheet('Groups');
  historySheet = ss.getSheetByName('History') || ss.insertSheet('History');

  // Run headers only on first setup
  ensureHeaders_(attemptsSheet, ['attemptId', 'sessionId', 'traineeId', 'score', 'timestamp', 'status']);
  ensureHeaders_(sessionsSheet, ['sessionId', 'name', 'instructor', 'created', 'status', 'published']);
  ensureHeaders_(itemsSheet, ['itemId', 'sessionId', 'itemNumber', 'content', 'type']);
  ensureHeaders_(itemResponsesSheet, ['responseId', 'attemptId', 'itemId', 'response', 'timestamp']);
  ensureHeaders_(traineesSheet, ['traineeId', 'name', 'email', 'group', 'created', 'status']);
  ensureHeaders_(instructorsSheet, ['instructorId', 'name', 'email', 'role', 'created', 'status']);
  ensureHeaders_(intakesSheet, ['intakeId', 'name', 'created']);
  ensureHeaders_(groupsSheet, ['groupId', 'name', 'intakeId', 'created']);
  ensureHeaders_(historySheet, ['historyId', 'event', 'userId', 'timestamp', 'details']);

  cache_.sheetInit = true;
}

// ============================================================================
// OPTIMIZED: BUILD SUMMARY (Most frequently called)
// ============================================================================

function buildSummary_(params) {
  // Auth check
  if (!params.sessionId) {
    return { error: 'No sessionId provided' };
  }

  const sessionId = params.sessionId;

  // Get attempts data (only needed columns)
  const attemptsLastRow = attemptsSheet.getLastRow();
  if (attemptsLastRow <= 1) {
    return { items: [], sessionId: sessionId };
  }

  // Read only columns we need: sessionId, traineeId, score, timestamp, etc.
  const attemptsRange = attemptsSheet.getRange(2, 1, attemptsLastRow - 1, 10);
  const attemptsValues = attemptsRange.getValues();

  // Build map of session attempts (index by itemId for O(1) lookup)
  const itemAttempts = {};
  const traineeScores = {};

  for (let r = 0; r < attemptsValues.length; r++) {
    const row = attemptsValues[r];
    if (row[1] === sessionId) { // Match by sessionId (column 2)
      const itemId = row[3];
      const traineeId = row[2];
      const score = row[4];

      if (!itemAttempts[itemId]) {
        itemAttempts[itemId] = [];
      }
      itemAttempts[itemId].push({
        traineeId: traineeId,
        score: score,
        timestamp: row[5]
      });

      // Track trainee scores
      if (!traineeScores[traineeId]) {
        traineeScores[traineeId] = 0;
      }
      traineeScores[traineeId] += score || 0;
    }
  }

  // Get items for this session
  const itemsLastRow = itemsSheet.getLastRow();
  const itemsRange = itemsSheet.getRange(2, 1, itemsLastRow - 1, 12);
  const itemsValues = itemsRange.getValues();

  // Build items map
  const itemsMap = {};
  for (let r = 0; r < itemsValues.length; r++) {
    const row = itemsValues[r];
    if (row[1] === sessionId) { // Match by sessionId
      itemsMap[row[0]] = row;
    }
  }

  // Build summary
  const items = [];
  for (const itemId in itemsMap) {
    const itemRow = itemsMap[itemId];
    const attempts = itemAttempts[itemId] || [];

    items.push({
      itemId: itemId,
      itemNumber: itemRow[2],
      content: itemRow[3],
      type: itemRow[4],
      attemptCount: attempts.length,
      attempts: attempts
    });
  }

  return {
    sessionId: sessionId,
    items: items,
    traineeScores: traineeScores
  };
}

// ============================================================================
// OPTIMIZED: SESSION LIST
// ============================================================================

function sessionList_(params) {
  const instructorId = params.instructorId;
  if (!instructorId) {
    return { error: 'Unauthorized' };
  }

  // Get only relevant columns
  const lastRow = sessionsSheet.getLastRow();
  if (lastRow <= 1) {
    return { sessions: [] };
  }

  const sessionsRange = sessionsSheet.getRange(2, 1, lastRow - 1, 12);
  const sessionsValues = sessionsRange.getValues();

  const sessions = [];

  for (let r = 0; r < sessionsValues.length; r++) {
    const row = sessionsValues[r];
    // Check: owned by instructor, and not deleted
    if (row[2] === instructorId && row[5] !== 'deleted') {
      sessions.push({
        sessionId: row[0],
        name: row[1],
        instructor: row[2],
        created: row[3],
        status: row[4],
        published: row[5]
      });
    }
  }

  // Sort by created date (newest first)
  sessions.sort((a, b) => new Date(b.created) - new Date(a.created));

  return { sessions: sessions };
}

// ============================================================================
// OPTIMIZED: ROSTER LIST (Avoid full iteration)
// ============================================================================

function rosterList_(params) {
  const groupId = params.groupId;
  if (!groupId) {
    return { error: 'No groupId provided' };
  }

  // Get trainees in group (single pass)
  const traineesLastRow = traineesSheet.getLastRow();
  if (traineesLastRow <= 1) {
    return { trainees: [] };
  }

  const traineesRange = traineesSheet.getRange(2, 1, traineesLastRow - 1, 10);
  const traineesValues = traineesRange.getValues();

  const trainees = [];

  for (let r = 0; r < traineesValues.length; r++) {
    const row = traineesValues[r];
    if (row[3] === groupId) { // group column
      trainees.push({
        traineeId: row[0],
        name: row[1],
        email: row[2],
        group: row[3],
        created: row[4],
        status: row[5]
      });
    }
  }

  return { trainees: trainees };
}

// ============================================================================
// OPTIMIZED: TRAINEE HISTORY (Cache-friendly)
// ============================================================================

function traineeHistory_(params) {
  const traineeId = params.traineeId;
  if (!traineeId) {
    return { error: 'No traineeId provided' };
  }

  // Get attempts for trainee
  const attemptsLastRow = attemptsSheet.getLastRow();
  if (attemptsLastRow <= 1) {
    return { history: [] };
  }

  const attemptsRange = attemptsSheet.getRange(2, 1, attemptsLastRow - 1, 10);
  const attemptsValues = attemptsRange.getValues();

  const history = [];

  for (let r = 0; r < attemptsValues.length; r++) {
    const row = attemptsValues[r];
    if (row[2] === traineeId) { // traineeId column
      history.push({
        attemptId: row[0],
        sessionId: row[1],
        score: row[4],
        timestamp: row[5],
        status: row[6]
      });
    }
  }

  // Sort by timestamp (newest first)
  history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return { history: history };
}

// ============================================================================
// OPTIMIZED: SESSION REPORT
// ============================================================================

function sessionReport_(params) {
  const sessionId = params.sessionId;
  if (!sessionId) {
    return { error: 'No sessionId provided' };
  }

  // Get session details
  const sessionLastRow = sessionsSheet.getLastRow();
  let sessionName = '';

  if (sessionLastRow > 1) {
    const sessionsRange = sessionsSheet.getRange(2, 1, sessionLastRow - 1, 12);
    const sessionsValues = sessionsRange.getValues();

    for (let r = 0; r < sessionsValues.length; r++) {
      if (sessionsValues[r][0] === sessionId) {
        sessionName = sessionsValues[r][1];
        break;
      }
    }
  }

  // Use buildSummary_ for the item details
  const summary = buildSummary_({ sessionId: sessionId });

  // Get trainee details map
  const traineeMap = getTraineeMap_();

  // Enrich attempts with trainee info
  const report = {
    sessionId: sessionId,
    sessionName: sessionName,
    items: summary.items,
    traineeScores: summary.traineeScores,
    trainees: {}
  };

  // Add trainee details
  for (const traineeId in summary.traineeScores) {
    const traineeData = traineeMap.get(traineeId);
    report.trainees[traineeId] = {
      name: traineeData ? traineeData[1] : 'Unknown',
      email: traineeData ? traineeData[2] : '',
      totalScore: summary.traineeScores[traineeId]
    };
  }

  return report;
}

// ============================================================================
// OPTIMIZED: GET ITEMS MAP (For caching)
// ============================================================================

function getItemsMap_() {
  // Check cache
  let itemsMap = getCache_('items');
  if (itemsMap) {
    return itemsMap;
  }

  itemsMap = new Map();

  const itemsLastRow = itemsSheet.getLastRow();
  if (itemsLastRow <= 1) {
    setCache_('items', itemsMap);
    return itemsMap;
  }

  const itemsRange = itemsSheet.getRange(2, 1, itemsLastRow - 1, 12);
  const itemsValues = itemsRange.getValues();

  for (let r = 0; r < itemsValues.length; r++) {
    itemsMap.set(itemsValues[r][0], itemsValues[r]);
  }

  setCache_('items', itemsMap);
  return itemsMap;
}

// ============================================================================
// OPTIMIZED: GET TRAINEE MAP (For caching)
// ============================================================================

function getTraineeMap_() {
  // Check cache
  let traineeMap = getCache_('trainees');
  if (traineeMap) {
    return traineeMap;
  }

  traineeMap = new Map();

  const traineesLastRow = traineesSheet.getLastRow();
  if (traineesLastRow <= 1) {
    setCache_('trainees', traineeMap);
    return traineeMap;
  }

  const traineesRange = traineesSheet.getRange(2, 1, traineesLastRow - 1, 10);
  const traineesValues = traineesRange.getValues();

  for (let r = 0; r < traineesValues.length; r++) {
    traineeMap.set(traineesValues[r][0], traineesValues[r]);
  }

  setCache_('trainees', traineeMap);
  return traineeMap;
}

// ============================================================================
// OPTIMIZED: GET GROUPS MAP (For caching)
// ============================================================================

function getGroupsMap_() {
  // Check cache
  let groupsMap = getCache_('groups');
  if (groupsMap) {
    return groupsMap;
  }

  groupsMap = new Map();

  const groupsLastRow = groupsSheet.getLastRow();
  if (groupsLastRow <= 1) {
    setCache_('groups', groupsMap);
    return groupsMap;
  }

  const groupsRange = groupsSheet.getRange(2, 1, groupsLastRow - 1, 10);
  const groupsValues = groupsRange.getValues();

  for (let r = 0; r < groupsValues.length; r++) {
    groupsMap.set(groupsValues[r][0], groupsValues[r]);
  }

  setCache_('groups', groupsMap);
  return groupsMap;
}

// ============================================================================
// AUTH & LOGIN (Performance optimized)
// ============================================================================

function traineeLogin_(params) {
  const username = normalizeUsername_(params.username);
  const password = params.password;

  if (!username || !password) {
    return { error: 'Missing credentials' };
  }

  // Find trainee by username
  const traineesLastRow = traineesSheet.getLastRow();
  if (traineesLastRow <= 1) {
    return { error: 'Invalid credentials' };
  }

  const traineesRange = traineesSheet.getRange(2, 1, traineesLastRow - 1, 10);
  const traineesValues = traineesRange.getValues();

  for (let r = 0; r < traineesValues.length; r++) {
    const row = traineesValues[r];
    if (row[1] === username) { // Name column (assuming username is name)
      // Check password
      if (hashPassword_(password) === row[9]) { // password hash column
        // Generate token
        const token = makeToken_();

        // Update token (use specific range update, not full sheet)
        traineesSheet.getRange(r + 2, 7).setValue(token); // Update token column

        return {
          traineeId: row[0],
          name: row[1],
          token: token
        };
      }
    }
  }

  return { error: 'Invalid credentials' };
}

function instructorLogin_(params) {
  const username = params.username;
  const password = params.password;

  if (!username || !password) {
    return { error: 'Missing credentials' };
  }

  // Find instructor by username
  const instructorsLastRow = instructorsSheet.getLastRow();
  if (instructorsLastRow <= 1) {
    return { error: 'Invalid credentials' };
  }

  const instructorsRange = instructorsSheet.getRange(2, 1, instructorsLastRow - 1, 10);
  const instructorsValues = instructorsRange.getValues();

  for (let r = 0; r < instructorsValues.length; r++) {
    const row = instructorsValues[r];
    if (row[1] === username) {
      // Check password
      if (hashPassword_(password) === row[9]) {
        // Generate token
        const token = makeToken_();

        // Update token (use specific range update)
        instructorsSheet.getRange(r + 2, 7).setValue(token);

        return {
          instructorId: row[0],
          name: row[1],
          role: row[3],
          token: token
        };
      }
    }
  }

  return { error: 'Invalid credentials' };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function normalizeUsername_(username) {
  return username ? username.trim().toLowerCase() : '';
}

function makeToken_() {
  // Generate random token
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function hashPassword_(password) {
  // Simple hash for demo - in production use Utilities.computeDigest()
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password
  );
}

function ensureHeaders_(sheet, headers) {
  if (!sheet || !headers) return;

  const range = sheet.getRange(1, 1, 1, headers.length);
  const existingHeaders = range.getValues()[0];

  // Only update if headers are missing
  const needsUpdate = headers.some((h, i) => existingHeaders[i] !== h);

  if (needsUpdate) {
    range.setValues([headers]);
  }
}

function rowsOf_(sheet, colNum) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
  return range.getValues();
}

// ============================================================================
// MAIN ENTRY POINT (Optimized)
// ============================================================================

// Global sheet references
let attemptsSheet, sessionsSheet, itemsSheet, itemResponsesSheet;
let traineesSheet, instructorsSheet, intakesSheet, groupsSheet, historySheet;

function doPost(e) {
  try {
    // Initialize sheets (cheap if already done)
    ensureSheets_();

    // Parse request
    const params = JSON.parse(e.postData.contents);
    const action = params.action;

    // Clear old cache on data modifications
    if (['traineeLogin_', 'sessionPublish_', 'saveAttempt_'].includes(action)) {
      clearCache_();
    }

    // Route to appropriate function
    if (typeof window !== 'undefined' && window[action]) {
      const result = window[action](params);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'traineeLogin') {
      return ContentService.createTextOutput(JSON.stringify(traineeLogin_(params)))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'instructorLogin') {
      return ContentService.createTextOutput(JSON.stringify(instructorLogin_(params)))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'sessionList') {
      return ContentService.createTextOutput(JSON.stringify(sessionList_(params)))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'buildSummary') {
      return ContentService.createTextOutput(JSON.stringify(buildSummary_(params)))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'rosterList') {
      return ContentService.createTextOutput(JSON.stringify(rosterList_(params)))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'traineeHistory') {
      return ContentService.createTextOutput(JSON.stringify(traineeHistory_(params)))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'sessionReport') {
      return ContentService.createTextOutput(JSON.stringify(sessionReport_(params)))
        .setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Unknown action: ' + action }))
        .setMimeType(ContentService.MimeType.JSON);
    }

  } catch (err) {
    Logger.log('Error in doPost: ' + err);
    return ContentService.createTextOutput(JSON.stringify({
      error: 'Server error: ' + err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
