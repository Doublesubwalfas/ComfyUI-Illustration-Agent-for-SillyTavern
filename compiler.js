export const MEMORY_STOPWORDS = new Set([
    'cinematic', 'dramatic lighting', 'wide shot', 'close-up', 'soft focus', 'rule of thirds', 
    'volumetric', 'masterpiece', 'best quality', 'highres', '8k', '4k', 'detailed', 'intricate',
    'ambient occlusion', 'raytraced', 'dof', 'bokeh', 'establishing shot', 'portrait'
]);

export function compilePrompt(rawPos, rawNeg, kind) {
    // Stage 1: Normalize
    const norm = (str) => (str || '').split(',')
        .map(t => t.trim().toLowerCase().replace(/_/g, ' '))
        .filter(t => t.length > 0);
    
    let posTags = norm(rawPos);
    let negTags = norm(rawNeg);

    // Stage 2: Deduplicate & Cross-check
    posTags = [...new Set(posTags)];
    negTags = [...new Set(negTags)];
    
    // Negatives win: remove pos tags that exist in neg
    const negSet = new Set(negTags);
    posTags = posTags.filter(t => !negSet.has(t));

    // Stage 3: Negative Migration
    // Matches "no text", "without humans", "shirt-free"
    const negPrefixRegex = /^(no|not|avoid|without|free\s+of)\s+(.+)$/i;
    const negSuffixRegex = /^(.+)-free$/i;
    
    let migrations = 0;
    const finalPos = [];
    
    for (const tag of posTags) {
        let match = negPrefixRegex.exec(tag);
        if (match && migrations < 20) {
            negTags.push(match[2].trim());
            migrations++;
            continue;
        }
        match = negSuffixRegex.exec(tag);
        if (match && migrations < 20) {
            negTags.push(match[1].trim());
            migrations++;
            continue;
        }
        finalPos.push(tag);
    }
    
    posTags = finalPos;

    // Stage 4: Per-kind Injection
    const kindAdditions = {
        illustration: { p: [], n: ['watermark', 'signature', 'ui', 'text'] },
        comic: { p: ['comic page', 'panel layout', 'speech bubbles'], n: ['watermark', 'signature', 'blurry text', 'malformed speech bubbles'] },
        colored_manga: { p: ['colored manga', 'screentone', 'speed lines'], n: ['watermark', 'signature', 'unreadable text', 'broken lettering'] },
        bw_manga: { p: ['black and white manga', 'ink', 'screentone', 'heavy blacks'], n: ['watermark', 'signature', 'color', 'full-color render'] },
        background: { p: ['establishing shot', 'no characters', 'environment focus'], n: ['people', 'character', 'portrait', 'crowd', 'watermark', 'signature'] },
        selfie: { p: ['selfie', 'close-up', 'phone camera'], n: ['watermark', 'signature', 'ui', 'malformed hands'] }
    };

    if (kindAdditions[kind]) {
        const { p, n } = kindAdditions[kind];
        const currentPosSet = new Set(posTags);
        const currentNegSet = new Set(negTags);
        
        p.forEach(t => { if (!currentPosSet.has(t)) posTags.push(t); });
        n.forEach(t => { if (!currentNegSet.has(t)) negTags.push(t); });
    }

    return {
        positive: posTags.join(', '),
        negative: negTags.join(', ')
    };
}