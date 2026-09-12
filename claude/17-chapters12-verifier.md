# Chapters 01 & 02 answer-key verification (v36)

## Origin

Adnane queried a screenshot. He was right that it was wrong; **the bank was not**. The wrong tick came from *my demo data*. 

He then asked for the remaining unverified questions to be checked — "this is crucial".

## `verify_ch12.py` — 391 of 456 checked, one real error found

Re-derives each answer from the question text before reading the stored key. **44 matchers**, covering all question types.

### The one real defect

**Version C, Q26** asked for the LCD of 1/9, 1/3 and 1/18. The LCD (18) was not among the four options. Changed denominators and key.

## Testing

Mutation-tested three times. **All caught.**
