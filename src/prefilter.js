// Local "sensing" step.
// Fixed to retain spoken visual statements (like "Take a look at this photo")
const STRONG = [
    'photo\\w*', 'picture', 'selfie', 'camera', 'snapshot', 'screenshot', 'polaroid', 'portrait',
    'sketch\\w*', 'paint(?:ing|s)\\b', 'pose[sd]?\\b', 'posing',
    'undress\\w*', 'strip(?:s|ped|ping)?\\b', 'unbutton\\w*', 'unzip\\w*',
    'naked', 'nude', 'topless', 'lingerie', 'bikini', 'swimsuit',
    'takes? off', 'took off', 'slips? (?:into|out of)', 'chang(?:e|es|ed|ing) (?:into|clothes|outfit)', 'puts? on',
    'mirror', 'reflection', 'sunset', 'sunrise', 'fireworks',
    'kiss(?:es|ed|ing)?\\b', 'embrac\\w+', 'hugs?\\b', 'hugged', 'kneel\\w*',
    'bends? over', 'bent over', 'twirl\\w*', 'spins? around', 'turns? around', 'danc(?:e|es|ed|ing)\\b'
];

const WEAK = [
    'smil\\w*', 'wink\\w*', 'grin\\w*', 'blush\\w*', 'giggl\\w*', 'laugh\\w*',
    'outfit', 'dress(?:es|ed)?\\b', 'skirt', 'blouse', 'gown', 'uniform', 'costume', 'stockings?', 'heels', 'wear(?:s|ing)?\\b', 'wore',
    'wav(?:e|es|ed|ing)\\b', 'rain\\w*', 'snow\\w*', 'storm\\w*', 'moonlight',
    'beach', 'forest', 'rooftop', 'balcony', 'shower', 'bath(?:tub|room)?\\b', 'pool\\b', 'bedroom', 'garden', 'lake', 'ocean', 'mountain',
    'leans? (?:in|forward|back|against)'
];

const mk = (list) => new RegExp('\\b(?:' + list.join('|') + ')', 'gi');
const STRONG_RE = mk(STRONG);
const WEAK_RE = mk(WEAK);

const extraCache = new Map();
function extraRegex(extra) {
    const key = (extra || '').trim();
    if (!key) return null;
    if (!extraCache.has(key)) {
        const words = key.split(',').map(w => w.trim()).filter(Boolean)
            .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        extraCache.set(key, words.length ? new RegExp('\\b(?:' + words.join('|') + ')', 'gi') : null);
    }
    return extraCache.get(key);
}

function distinct(text, re) {
    const found = new Set();
    for (const m of String(text).matchAll(re)) found.add(m[0].toLowerCase());
    return found;
}

export function scoreCues(text, extra = '') {
    const strong = distinct(text, STRONG_RE);
    const weak = distinct(text, WEAK_RE);
    const ex = extraRegex(extra);
    if (ex) for (const w of distinct(text, ex)) strong.add(w);
    for (const w of strong) weak.delete(w);
    return { score: strong.size * 2 + weak.size, hits: [...strong, ...weak] };
}

export function passesGate({ assistantText, userText = '', sensitivity = 2, extra = '' }) {
    // Scores the assistant and user text directly without stripping dialogue
    const a = scoreCues(assistantText, extra);
    const u = scoreCues(userText, extra);
    const score = a.score + u.score;
    return { pass: score >= (Number(sensitivity) || 2), score, hits: [...a.hits, ...u.hits] };
}