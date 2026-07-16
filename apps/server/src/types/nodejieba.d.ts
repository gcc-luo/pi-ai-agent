declare module "nodejieba" {
  /** Segment text into words using MixSegment mode (HMM + DAG). */
  function cut(sentence: string, hmm?: boolean): string[];
  /** Segment text into words using IndexMode (finer granularity). */
  function cutForSearch(sentence: string, hmm?: boolean): string[];
  /** Segment text and tag each word with its part-of-speech. */
  function tag(sentence: string, hmm?: boolean): Array<{ word: string; tag: string }>;
  /** Extract keywords using TF-IDF. */
  function extract(sentence: string, topN: number, allowedPOS?: string[]): Array<{ word: string; weight: number }>;
  /** Add a word to the user dictionary. */
  function insertWord(word: string): boolean;
  /** Initialize jieba with custom dictionary paths. */
  function load(config: {
    dict?: string;
    hmmDict?: string;
    userDict?: string;
    idfDict?: string;
    stopWordDict?: string;
  }): void;
}
