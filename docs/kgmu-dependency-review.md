# KGMU dependency review after parser closure

Scope: medicine, pediatrics, dentistry, foreign students.

## Result

Steps 2-7 stay unchanged. The existing event schema, QA, versioning and ICS are sufficient for all confirmed parser rules. C22 remains a normal `needs_review` case and requires no new downstream model.

C15 requires one targeted extension in steps 8-12. A student's elective cannot be chosen at group level because students in the same group may have different choices.

Decision: keep the base group schedule universal and add a separate source-bound `schedule-choice-manifest/v1`. Each required choice set contains stable option IDs and a versioned overlay schedule-batch for every allowed option. Overlay events remain ordinary `schedule-event/v1` events and use the existing validation, versioning and postprocessing pipeline.

Publication must bind the base schedule and the matching immutable choice-manifest version to one current group revision. Checkout must require all mandatory selections before payment. The order and subscription persist selected option IDs. The personal feed is built from the base schedule plus the selected overlays and then postprocessed again. Subscription URL rotation preserves the selections. If a saved option disappears in a later revision, the feed fails closed rather than selecting another option automatically.

Step 8 adds optional source-bound choice manifests to canonical review. Step 9 stores and publishes them with the base group revision. Steps 10-11 add selection to checkout/order/subscription and personal feed composition. Step 12 must not sell a group whose required choice manifest is incomplete. The existing four-faculty source watcher does not change.
