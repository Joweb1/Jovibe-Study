/**
 * Shared prompts and JSON schemas used by both the Gemini routes and the
 * OpenAI-compatible provider proxy. Keeping them in one module guarantees
 * OCR output stays structurally identical no matter which provider answers.
 */

export function buildVisionPrompt(mode: string, pageNumber?: number): string {
  const pageHint = pageNumber ? `This image is Page ${pageNumber} of a document.` : '';

  if (mode === 'handwriting') {
    return [
      'You are an academic document transcription assistant specializing in handwritten study notes.',
      pageHint,
      'Transcribe the handwritten notes accurately while preserving structure: headings, subheadings, numbered or bulleted lists, definitions, formulas, examples, and tables (in Markdown format).',
      'CRITICAL ACCURACY RULE: If any word, symbol, or phrase is unclear, smudged, or ambiguous, DO NOT invent or guess confidently. Mark uncertain words inline as [unclear: best guess] or [illegible] if unreadable.',
      'Return structured JSON matching the schema. Set uncertainCount to the exact number of [unclear: ...] or [illegible] markers included in your output.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return [
    'You are an academic OCR and document structuring assistant.',
    pageHint,
    'Extract all readable academic text from this textbook page or scanned document while faithfully preserving headings, subheadings, paragraphs, bullet lists, definitions, worked examples, and tables (formatted cleanly in Markdown).',
    'Omit decorative page headers/footers unless they carry meaningful section or page context.',
    'If any text is cut off, blurred, or unreadable, mark it explicitly as [unclear: best guess] or [illegible] rather than inventing content, and count those markers in uncertainCount.',
    'Return structured JSON matching the schema.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** JSON Schema (lowercase) equivalent of the Gemini vision response schema. */
export const VISION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      description: 'Ordered structured sections extracted from the image.',
      items: {
        type: 'object',
        properties: {
          heading: {
            type: 'string',
            description: 'Section heading or concise topic label.',
          },
          level: {
            type: 'integer',
            description:
              'Heading level (1 for main heading, 2 for subheading, 3 for minor heading).',
          },
          content: {
            type: 'string',
            description:
              'Formatted text content preserving paragraphs, lists, definitions, examples, and markdown tables.',
          },
        },
        required: ['heading', 'level', 'content'],
        additionalProperties: false,
      },
    },
    uncertainCount: {
      type: 'integer',
      description: 'Count of [unclear: ...] or [illegible] markers in the extracted text.',
    },
    notes: {
      type: 'string',
      description: 'Brief quality note if applicable, otherwise empty string.',
    },
  },
  required: ['sections', 'uncertainCount', 'notes'],
  additionalProperties: false,
};

const TYPE_MAP: Record<string, string> = {
  OBJECT: 'object',
  ARRAY: 'array',
  STRING: 'string',
  INTEGER: 'integer',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  NULL: 'null',
};

/**
 * Converts Gemini's `Type` schema format (UPPERCASE type names) into standard
 * JSON Schema for OpenAI-compatible `response_format.json_schema` requests.
 */
export function toJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && typeof value === 'string') {
      output.type = TYPE_MAP[value.toUpperCase()] ?? value.toLowerCase();
      continue;
    }

    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const properties: Record<string, unknown> = {};
      for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
        if (propValue && typeof propValue === 'object' && !Array.isArray(propValue)) {
          properties[propKey] = toJsonSchema(propValue as Record<string, unknown>);
        } else {
          properties[propKey] = propValue;
        }
      }
      output.properties = properties;
      continue;
    }

    if (key === 'items' && value && typeof value === 'object' && !Array.isArray(value)) {
      output.items = toJsonSchema(value as Record<string, unknown>);
      continue;
    }

    if (key === 'additionalProperties' || key === 'required' || key === 'description' || key === 'enum') {
      output[key] = value;
      continue;
    }

    output[key] = value;
  }

  if (output.type === 'object' && output.additionalProperties === undefined) {
    output.additionalProperties = false;
  }

  return output;
}
