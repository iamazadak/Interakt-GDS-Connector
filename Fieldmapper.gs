// =============================================================================
// lib/FieldMapper.gs  —  v4.1.0
// =============================================================================
// Converts raw Interakt customer object → flat row matching getLeadHeaders().
//
// KEY ARCHITECTURE (confirmed from live API response June 2026):
//
//   _internal_stage_id         → decoded via STAGE_MAP  → Status name
//   _internal_contact_owner_id → decoded via AGENT_MAP  → agent name + email
//   _internal_closure_date     → stored as-is from API
//   _internal_lead_source      → actual lead source channel
//
// DATE FORMAT: stored exactly as received from API — no conversion.
//   created_at_utc:        "2026-06-08T09:32:45"
//   modified_at_utc:       "2026-06-08T17:04:47.425000"
//   _internal_closure_date:"2026-06-18T09:32:45.663000"
//   Looker Studio parses ISO strings natively.
//
// FIELDS THAT DO NOT EXIST IN API (never use these):
//   lead_status_crm, account_owner_email_crm, closure_date
// =============================================================================

var FieldMapper = (function() {

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  function userToRow(user) {
    var traits = _safeTraits(user);
    var row    = [];

    // 1. Standard fields (top-level on the customer object)
    CONFIG.STANDARD_FIELDS.forEach(function(field) {
      row.push(_extractStandardField(user, traits, field));
    });

    // 2. Trait fields in tier order CORE → HIGH → MEDIUM → LOW
    ['CORE', 'HIGH', 'MEDIUM', 'LOW'].forEach(function(tier) {
      CONFIG.TRAIT_FIELDS
        .filter(function(t) { return t.tier === tier; })
        .forEach(function(traitDef) {
          row.push(_extractTraitField(traits, traitDef));
        });
    });

    // 3. Computed formula placeholders (written as formulas by SheetManager)
    CONFIG.COMPUTED_COLUMNS.forEach(function() { row.push(''); });

    // 4. Internal metadata
    row.push(_rowHash(user, traits));
    row.push(new Date().toISOString());

    return row;
  }

  function getUniqueKey(user) {
    return _normalisePhone(user.phone_number || user.phoneNumber || '');
  }

  // ---------------------------------------------------------------------------
  // Private: standard field extraction
  // ---------------------------------------------------------------------------

  function _extractStandardField(user, traits, field) {
    switch (field) {

      case 'phoneNumber':
        // API: phone_number — no country prefix e.g. "8696956039"
        return _normalisePhone(user.phone_number || user.phoneNumber || '');

      case 'countryCode':
        // API: country_code — comes as "+91", strip leading +
        return _clean(user.country_code || user.countryCode || '').replace(/^\+/, '');

      case 'name':
        // API: traits.name — default field lives inside traits{}
        return _clean(traits['name'] || user.name || '');

      case 'email':
        // API: traits.email — default field lives inside traits{}
        return String(traits['email'] || user.email || '').trim().toLowerCase();

      case 'created_at_utc':
        // API: "2026-06-08T09:32:45" — stored as-is, no conversion
        return _clean(user.created_at_utc || '');

      case 'modified_at_utc':
        // API: "2026-06-08T17:04:47.425000" — stored as-is, no conversion
        return _clean(user.modified_at_utc || '');

      case 'tags':
        if (Array.isArray(user.tags)) return user.tags.join(', ');
        return _clean(user.tags || '');

      case 'user_id':
        // API: user_id — platform/channel user ID (distinct from Interakt UUID)
        return _clean(user.user_id || '');

      case 'interakt_id':
        // API: id — Interakt's internal UUID e.g. "9cb7f959-2b23-487f-..."
        return _clean(user.id || '');

      case 'entry_channel':
        // API: customer_created_at_source — how contact entered Interakt
        // e.g. "Track" (via API), "MessagePersister" (WhatsApp message)
        return _clean(user.customer_created_at_source || '');

      case 'channel_type':
        // API: channel_type — e.g. "Whatsapp", "Instagram"
        return _clean(user.channel_type || '');

      default:
        return _clean(user[field] || '');
    }
  }

  // ---------------------------------------------------------------------------
  // Private: trait field extraction with UUID decoding for derived fields
  // ---------------------------------------------------------------------------

  function _extractTraitField(traits, traitDef) {
    var key  = traitDef.key;
    var type = traitDef.type;

    // ── DERIVED: decoded from UUID lookups ───────────────────────────────────

    if (key === 'status') {
      // Decode _internal_stage_id UUID → Status name via STAGE_MAP
      var stageId = _clean(traits['_internal_stage_id'] || '');
      if (!stageId) return '';
      return CONFIG.STAGE_MAP[stageId] || ('Unmapped: ' + stageId.substring(0, 8) + '...');
    }

    if (key === 'account_owner_name') {
      // Decode _internal_contact_owner_id UUID → agent name via AGENT_MAP
      var ownerId = _clean(traits['_internal_contact_owner_id'] || '');
      if (!ownerId) return '';
      var agent = CONFIG.AGENT_MAP[ownerId];
      return agent ? agent.name : ('Unmapped: ' + ownerId.substring(0, 8) + '...');
    }

    if (key === 'account_owner_email') {
      // Decode _internal_contact_owner_id UUID → agent email via AGENT_MAP
      var ownerIdE = _clean(traits['_internal_contact_owner_id'] || '');
      if (!ownerIdE) return '';
      var agentE = CONFIG.AGENT_MAP[ownerIdE];
      return agentE ? agentE.email : '';
    }

    // ── DATETIME: store as-is from API ───────────────────────────────────────
    // Format confirmed: "2026-06-18T09:32:45.663000"
    // Looker Studio parses ISO datetime strings natively — no conversion needed.

    if (type === 'datetime') {
      var raw = _getTraitValue(traits, key);
      return _clean(raw || '');
    }

    // ── RAW UUID columns (LOW tier): store UUID directly ────────────────────

    if (key === '_internal_stage_id' || key === '_internal_contact_owner_id') {
      return _clean(traits[key] || '');
    }

    // ── All other traits ─────────────────────────────────────────────────────
    var rawVal = _getTraitValue(traits, key);
    return _normaliseByType(rawVal, type);
  }

  // ---------------------------------------------------------------------------
  // Private: trait key lookup with fallback variants
  // Interakt is inconsistent with key casing — try multiple variants
  // ---------------------------------------------------------------------------

  function _getTraitValue(traits, key) {
    // 1. Exact match — covers "State", "City", "_internal_*", "willing_to_relocate?"
    if (traits.hasOwnProperty(key)) return traits[key];

    // 2. All-lowercase — covers "highestqualification" vs "HighestQualification"
    var lower = key.toLowerCase();
    if (traits.hasOwnProperty(lower)) return traits[lower];

    // 3. Spaces → underscores
    var underscored = key.replace(/\s+/g, '_').toLowerCase();
    if (traits.hasOwnProperty(underscored)) return traits[underscored];

    // 4. Strip all spaces (camelCase fallback)
    var nospace = key.replace(/\s+/g, '');
    if (traits.hasOwnProperty(nospace)) return traits[nospace];

    // 5. Strip trailing ? — some systems drop punctuation from boolean keys
    if (key.endsWith('?')) {
      var stripped = key.slice(0, -1);
      if (traits.hasOwnProperty(stripped)) return traits[stripped];
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Private: type-aware value normalisation
  // ---------------------------------------------------------------------------

  function _normaliseByType(val, type) {
    if (val === null || val === undefined || val === '') return '';
    switch (type) {
      case 'number':    return _normaliseNumber(val);
      case 'boolean':   return _normaliseBoolean(val);
      case 'link':      return _normaliseLink(val);
      case 'datetime':  return _clean(val);   // stored as-is, no conversion
      case 'derived':   return _clean(val);   // already resolved above
      case 'selection':
      case 'text':
      default:          return _clean(val);
    }
  }

  function _normaliseNumber(val) {
    if (typeof val === 'number') return isNaN(val) ? '' : val;
    var s = String(val).trim()
      .replace(/[₹$€£,\s]/g, '')
      .replace(/k$/i,  '000')
      .replace(/l$/i,  '00000');
    var n = parseFloat(s);
    return isNaN(n) ? '' : n;
  }

  function _normaliseBoolean(val) {
    if (val === true  || val === 1)  return 'TRUE';
    if (val === false || val === 0)  return 'FALSE';
    var s = String(val).trim().toLowerCase();
    if (s === 'true'  || s === 'yes' || s === '1') return 'TRUE';
    if (s === 'false' || s === 'no'  || s === '0') return 'FALSE';
    return '';
  }

  function _normaliseLink(val) {
    var s = _clean(val);
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s;
  }

  function _normalisePhone(raw) {
    if (!raw) return '';
    return String(raw).replace(/[\s\-().]/g, '');
  }

  function _clean(val) {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join(', ');
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val).trim();
  }

  // ---------------------------------------------------------------------------
  // Private: row hash — includes all UUID fields so any change triggers update
  // ---------------------------------------------------------------------------

  function _rowHash(user, traits) {
    var traitSnapshot = CONFIG.TRAIT_FIELDS.map(function(t) {
      var v = _getTraitValue(traits, t.key);
      return t.key + ':' + (v !== null && v !== undefined ? String(v) : '');
    }).join('|');

    var parts = [
      user.phone_number               || user.phoneNumber || '',
      user.modified_at_utc            || '',
      user.id                         || '',
      user.user_id                    || '',
      user.customer_created_at_source || '',
      user.channel_type               || '',
      traits['_internal_stage_id']         || '',
      traits['_internal_contact_owner_id'] || '',
      traits['_internal_closure_date']     || '',
      Array.isArray(user.tags)
        ? user.tags.slice().sort().join(',')
        : (user.tags || ''),
      traitSnapshot,
    ].join('§');

    var hash = 5381;
    for (var i = 0; i < parts.length; i++) {
      hash = ((hash << 5) + hash) + parts.charCodeAt(i);
      hash = hash & hash;
    }
    return 'h' + Math.abs(hash).toString(16);
  }

  function _safeTraits(user) {
    return (user.traits && typeof user.traits === 'object') ? user.traits : {};
  }

  return { userToRow: userToRow, getUniqueKey: getUniqueKey };

})();