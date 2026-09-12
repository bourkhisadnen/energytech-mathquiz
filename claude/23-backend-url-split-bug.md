# The "No response from Google Apps Script" investigation (v30)

## Symptom

After deploying the intake backend, **Load intakes** and **Add intake** both showed the error message.

## The real defect found

`app.js` resolved the backend URL two different ways:
- login: the saved/built-in URL only.
- roster calls: the **on-screen "Instructor connection setup" box first**.

Anything left in that box split the app.

## Fixed

Single `activeWebAppUrl()` helper applied to all 14 call sites.

## Diagnostics added

`testBackendConnection` runs four probes in order.
