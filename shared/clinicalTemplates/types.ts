/** Firebase / Halo clinical note template field (bundled definitions). */
export interface ClinicalTemplateField {
  key: string;
  description: string;
  default?: string;
  from_profile?: boolean;
  spell_check?: string[];
  spell_check_terms?: string[];
}

export interface ClinicalTemplateDefinition {
  template_id: string;
  name: string;
  description?: string;
  doc_path: string;
  fields: ClinicalTemplateField[];
}

export type ClinicalTemplateMap = Record<string, ClinicalTemplateDefinition>;
