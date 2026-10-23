/**
 * OpenRouter API Integration
 * Sends regional health data (bulk statistics only, no PII) to Claude for analysis
 * Generates actionable recommendations for each region
 */

import type { RegionalStats } from './regionalDataAggregator';

export interface RegionalReport {
  region: string;
  riskLevel: string;
  summary: string;
  recommendations: string[];
  keyFindings: string[];
  priorityLevel: 'Low' | 'Medium' | 'High';
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Generate a rule-based regional screening analysis fallback
 * Used when OpenRouter key is missing, invalid, or offline
 */
export function generateRuleBasedRegionalAnalysis(
  regionName: string,
  stats?: RegionalStats,
  notice?: string
): RegionalReport {
  const patientCount = stats?.patientCount ?? 0;
  const recordingCount = stats?.recordingCount ?? 0;
  const risk = stats?.riskLevel ?? 'Low';
  const ageAvg = stats?.ageStats?.mean && isFinite(stats.ageStats.mean)
    ? stats.ageStats.mean.toFixed(1)
    : 'Adult';

  const keyFindings: string[] = [
    `Monitored cohort of ${patientCount} patient(s) across ${recordingCount} screening recording(s).`,
    `Cohort average age is ${ageAvg} years with regional baseline risk evaluated as ${risk}.`,
  ];

  if (stats?.biomarkerStats) {
    for (const [name, s] of Object.entries(stats.biomarkerStats)) {
      if (s && s.count > 0 && typeof s.mean === 'number' && isFinite(s.mean)) {
        keyFindings.push(
          `${name}: Regional mean ${s.mean.toFixed(2)} (Range: ${s.min.toFixed(2)} - ${s.max.toFixed(2)}).`
        );
      }
    }
  }

  const recommendations: string[] = [
    'Schedule periodic community biometric screenings for high-risk cohorts.',
    'Follow up on borderline readings with diagnostic point-of-care consultations.',
    'Promote preventive lifestyle guidance regarding cardiovascular health and nutrition.',
    'Monitor cohort trends over time to track regional intervention effectiveness.',
  ];

  if (notice) {
    keyFindings.unshift(`[Local Engine] ${notice}`);
  }

  return {
    region: regionName,
    summary: `Epidemiological screening profile for ${regionName} (${patientCount} patients, ${recordingCount} recordings). Biomarker distributions reflect a ${risk.toLowerCase()}-priority surveillance profile.`,
    keyFindings,
    recommendations,
    priorityLevel: risk,
    riskLevel: risk,
  };
}

/**
 * Generate analysis for a region based on aggregated health data
 */
export async function generateRegionalAnalysis(
  regionName: string,
  bulkDataSummary: string,
  openRouterKey: string,
  model = 'openai/gpt-4o-mini'
): Promise<RegionalReport> {
  if (!openRouterKey || openRouterKey.trim() === '') {
    throw new Error('OpenRouter API key not configured');
  }

  const systemPrompt = `You are a healthcare data analyst. Analyze the provided regional health data (bulk statistics only, NO individual patient data) and provide:

1. **Summary**: 2-3 sentence overview of regional health status
2. **Key Findings**: 3-4 bullet points of notable trends
3. **Recommendations**: 4-5 actionable steps for healthcare providers in this region (focus on prevention, resource allocation, community programs)
4. **Priority Level**: Classify as Low/Medium/High based on:
   - Risk level of biomarkers
   - High variance in measurements (indicates inconsistent health management)
   - Population size requiring intervention

=== CRITICAL DATA SECURITY RULES ===
1. NEVER EVER include or infer any individual patient names, identities, or personal information.
2. Only analyze and discuss aggregated statistics (means, distributions, counts, ranges).
3. All recommendations must be population/community-level, NEVER individual-specific.
4. All findings must reference only bulk statistics, never individual cases.
5. Do not attempt to identify or discuss any specific individuals.
6. Refuse any requests that would require disclosing patient-level data.

Be specific, data-driven, and practical. All recommendations should be implementable at regional/community level.
NEVER mention any patient names, identities, or individual details under any circumstances.`;

  const userPrompt = `Analyze this regional health data for ${regionName}:

${bulkDataSummary}

Provide your analysis in JSON format:
{
  "summary": "...",
  "keyFindings": ["...", "...", "..."],
  "recommendations": ["...", "...", "...", "..."],
  "priorityLevel": "Low|Medium|High"
}`;

  const requestModel = async (modelName: string) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Spectru Regional Health Analytics',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],
          temperature: 0.2,
          max_tokens: 1500,
          reasoning: { effort: 'none' },
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  };

  const candidateModels = Array.from(new Set([
    model,
    'openai/gpt-4o-mini',
    'nex-agi/nex-n2.5-mini:free',
    'deepseek/deepseek-v4-flash-0731:free',
  ]));

  let lastError: Error | null = null;

  for (const candidate of candidateModels) {
    try {
      const response = await requestModel(candidate);

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 401) {
          let msg = 'User not found / Invalid key';
          try {
            const parsed = JSON.parse(errorText);
            if (parsed?.error?.message) msg = parsed.error.message;
          } catch {}
          throw new Error(`Invalid or expired OpenRouter API key (${msg}). Please update your key in Settings.`);
        }

        // For 402, 429, 404, or other error, try next candidate model
        console.warn(`Regional analysis candidate ${candidate} returned ${response.status}, trying next...`);
        lastError = new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
        continue;
      }

      const data = await response.json();
      const rawContent = data.choices?.[0]?.message?.content;
      const content = Array.isArray(rawContent)
        ? rawContent
            .map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .join('\n')
        : typeof rawContent === 'string'
        ? rawContent
        : '';

      if (!content || !content.trim()) continue;

      let cleanStr = content.trim();
      if (cleanStr.startsWith('```')) {
        cleanStr = cleanStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      }

      // Parse JSON from response
      const jsonMatch = cleanStr.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        region: regionName,
        riskLevel: 'Calculate based on data',
        summary: parsed.summary || 'Regional health screening overview.',
        recommendations: parsed.recommendations || [],
        keyFindings: parsed.keyFindings || [],
        priorityLevel: parsed.priorityLevel || 'Medium',
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes('Invalid or expired')) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Regional candidate ${candidate} failed:`, lastError.message);
    }
  }

  throw lastError || new Error('No candidate AI models responded successfully.');
}

/**
 * Batch analyze multiple regions
 */
export async function generateMultipleRegionalAnalyses(
  regionDataMap: Record<string, string>,
  openRouterKey: string
): Promise<RegionalReport[]> {
  const reports: RegionalReport[] = [];

  for (const [regionName, dataString] of Object.entries(regionDataMap)) {
    try {
      const report = await generateRegionalAnalysis(
        regionName,
        dataString,
        openRouterKey
      );
      if (report) {
        reports.push(report);
      }
    } catch (err) {
      console.error(`Failed to analyze region ${regionName}:`, err);
    }
  }

  return reports;
}

/**
 * Validate OpenRouter API key format
 */
export function isValidOpenRouterKey(key: string): boolean {
  if (!key) return false;
  return key.trim().length > 10;
}

/**
 * Validate that input is a medical/health-related analysis request
 * Prevents misuse for non-medical purposes
 */
export function isMedicalAnalysisRequest(userInput: string): boolean {
  const medicalKeywords = ['health', 'biomarker', 'patient', 'medical', 'disease', 'risk', 'diagnosis', 'treatment', 'wellness', 'epidemic', 'data', 'regional', 'analysis', 'recommendation', 'report', 'screening'];
  const lowerInput = userInput.toLowerCase();
  return medicalKeywords.some(keyword => lowerInput.includes(keyword));
}
