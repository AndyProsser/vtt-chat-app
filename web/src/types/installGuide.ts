/** One instruction; `command` is shown in a copyable block under the text. */
export interface InstallStep {
  text: string;
  command?: string;
}

/** What to tell someone installing for one platform (or one Linux package format). */
export interface InstallGuide {
  id: string;
  label: string;
  /** One line: who this is for. */
  who: string;
  steps: InstallStep[];
}
