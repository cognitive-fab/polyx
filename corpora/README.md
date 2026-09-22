# corpora/

Gitignored. Datasets are fetched here by the `fetch-*.mjs` scripts and never committed, never redistributed, never shipped inside the product. See `DATASETS.md` for the terms each was used under.

```
corpora/
  abcd/        abcd_v1.1.json, guidelines.json, ontology.json, kb.json   (MIT)
  tau2/        generated trajectories, one directory per backbone+seed    (MIT)
  bpic2017/    XES event log                                              (read terms first)
```

`guidelines.json` and the τ²-bench policy documents are **evaluation input**. They are read only by `src/evaluate/`; the boundary check enforces it.
