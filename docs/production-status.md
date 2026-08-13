# KGMU canonical production status

## Medicine course 4

Canonical publication is complete for groups `401–420`.

Source:
- academic year: `2025/26`
- semester: `2`
- program: `medicine`
- course: `4`
- source file: `4_kurs_lechebnyy_fakultet-02-02-2026-14.xlsx`
- SHA-256: `146876a71f1ad8503593aeb82fcc72fef76022896b85d7f7dc61ca7ec97c0dae`
- parser review: `afe5e5ea-38e6-420b-8f3f-3f191b0865a7`

Publication result:
- status: `PUBLISHED`
- reason: `CANONICAL_REVIEWED_JSON_PUBLISHED`
- QA: `PASS`
- groups: `20`
- events: `2230`
- publication workflow run: `31706922335`
- persisted-state verification run: `31707362812`

The independent verification downloaded the staged XLSX from production again, recomputed its SHA-256, rematerialized all 20 canonical schedule batches and compared every persisted publication content fingerprint with a newly computed semantic fingerprint. All 20 matched.

## Group 408 control case

- schedule version: `ver_08f5298a1cdc46daa48662d009edc81b`
- content fingerprint: `sha256:ee1bbc291528ade9040b6310a0b8ed3f8cd4daa9cb555c8fbcdb446b65302786`
- confirmed overlapping source events preserved:
  - `Менеджмент в здравоохранении` — `12:00–15:05`
  - `ФАКУЛЬТЕТСКАЯ ТЕРАПИЯ, ПРОФЕССИОНАЛЬНЫЕ БОЛЕЗНИ` — `14:45–16:15`

## Published versions

```text
401  ver_cf65d49f70ef46c5ac95ec5742bdb019
402  ver_6be9084f38da4b39ab0e40054f8eadfb
403  ver_8ccd5eea24ef4fb5a5da16a7cdb7cea8
404  ver_c09ec241425e4528a4b318e7841202c3
405  ver_8253ebc76ef5411a8d2f01bb9f9abe6a
406  ver_5d91eae130fa4b9c9794d3f308220898
407  ver_b7bde3ff11764ffbaf6d5bcf23a05c5c
408  ver_08f5298a1cdc46daa48662d009edc81b
409  ver_23a71e3ad6304a0aa947d5d9f64dd698
410  ver_cb09728aa82d4b7a9dd463712280eb57
411  ver_9edfdbf907e9428cb708f3af1aa94280
412  ver_ec09f9a40eaa4aec8d9d843cabfe4906
413  ver_d9f34923729041e0801fa8325f73ca4d
414  ver_90de2888fc9e47dab0afe4f7b5becd9f
415  ver_c297b8dfba0c4caeb3f274d27f5b8ff6
416  ver_e0c94854bab34ff4b254ba3e3b4c9160
417  ver_cd31b608e7f1402db00383777b2d317b
418  ver_7338a0334f6f46dfa8234b293e6f43ee
419  ver_22ae424da1834bf694bab9abdcbee1cc
420  ver_1e5b8371b8284699b109f53f73ab0858
```

Group `401` was idempotent against its already published canonical content. Groups `402–420` received canonical versions during the full publication.

## Next production check

Verify subscription continuity across a real later schedule revision: an existing personalized ICS URL must return the new revision after publication without requiring the student to import the calendar again.
