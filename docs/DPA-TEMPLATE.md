# Data Processing Agreement (template)

> **Template. Not legal advice. Have it reviewed by a lawyer before signing.**
>
> Text in [square brackets] is to be filled in or agreed by the parties. Every fact about Bridge below comes from the public security page (https://bridge.floriangouloubi.com/docs/security/) and the code it points to. If the two ever differ, the code is what runs.

This Data Processing Agreement ("DPA") is made between:

- **[Customer legal name]**, [address], [registration number] (the "Controller" or "Customer"); and
- **Florian Gouloubi, sole proprietor (entrepreneur individuel), trading as Bridge**, 26 rue de la Tramontane, 34680 Saint-Georges-d'Orques, France, SIRET 947 632 055 00028 (the "Processor" or "Bridge").

It forms part of [the agreement or terms under which the Customer uses Bridge] (the "Agreement"), dated [date]. It applies where Bridge processes personal data on behalf of the Customer, as required by Article 28 of Regulation (EU) 2016/679 (the "GDPR").

## 1. Subject, duration, nature and purpose

1.1 **Subject.** Bridge provides a service that connects the Customer's design system, kept in the Customer's own GitHub repository, to design tools, documentation and AI assistants chosen by the Customer.

1.2 **Duration.** For as long as the Customer uses Bridge under the Agreement, then until the data is deleted as set out in section 10.

1.3 **Nature.** Storing, reading, updating and deleting account and team records; sending sign-in and invitation emails; keeping short-lived copies of reads from the Customer's repository; keeping encrypted GitHub tokens so that the Customer's AI assistant and the Figma plugin can act on the Customer's repository as the person who connected them.

1.4 **Purpose.** Only to provide Bridge to the Customer's team, as described in the Agreement and on the security page.

## 2. Categories of data subjects

The members of the Customer's team who use Bridge: people invited to a team, people who ask to join it, people who read its Library by email link, and people who connect an AI assistant or the Figma plugin.

Bridge does not process data about the Customer's own customers or the end users of the Customer's products.

## 3. Categories of personal data

- Account: email address, name, linked GitHub login and numeric id, creation date.
- Team membership: email, name, role, who added the person.
- Invitations and requests to join: email, name, role, team, inviter, dates.
- Records of branches and issues an email-only member made through Bridge.
- AI connector connections: team repository, app name, GitHub login, display name, dates, and the person's GitHub tokens (encrypted).
- Fix sessions: the steps the team's AI took on one component (names, never emails).
- Short-lived copies of GitHub reads, which can include GitHub names and profile pictures.

No special categories of data (GDPR Article 9) are requested or expected. No passwords are stored: people sign in with GitHub or a one-time email code.

Retention periods for each category are those listed in "What Bridge stores" on the security page, which forms part of Annex 2.

## 4. Processor obligations

Bridge shall:

4.1 process the personal data only on the Customer's documented instructions, including this DPA and the Agreement, unless EU or Member State law requires otherwise, in which case Bridge informs the Customer first unless that law forbids it;

4.2 tell the Customer if, in its opinion, an instruction infringes the GDPR or other data protection law;

4.3 not use the personal data for any other purpose, including advertising, profiling or training AI models;

4.4 implement the technical and organisational measures in Annex 2.

## 5. Confidentiality

Bridge ensures that every person authorised to process the personal data is bound by confidentiality. Today one person has access to production systems: the founder of Bridge, through their own accounts with Vercel, Upstash, Resend and GitHub. Bridge informs the Customer before granting production access to anyone else.

## 6. Security

Bridge implements the measures described in Annex 2 and keeps them at least at that level for the duration of this DPA. Bridge may update them, provided the overall level of security does not decrease.

## 7. Subprocessors

7.1 The Customer gives general authorisation for Bridge to use the subprocessors listed in Annex 3.

7.2 Bridge informs the Customer of any intended addition or replacement of a subprocessor at least 30 days in advance, by updating the security page and notifying the Customer's data protection contact by email. The Customer may object on reasonable data protection grounds within that period; if the parties cannot agree, the Customer may terminate the affected part of the Agreement without penalty.

7.3 Bridge imposes on each subprocessor data protection obligations that offer at least the same level of protection as this DPA, and remains responsible to the Customer for their performance.

## 8. Assistance

8.1 **Data subject requests.** Taking into account the nature of the processing, Bridge assists the Customer in answering requests from data subjects. Each person can already delete their own account in Studio (Account settings), and a team admin can remove members.

8.2 **Other obligations.** Bridge assists the Customer, as far as reasonably possible and with the information available to it, with data protection impact assessments and prior consultations (GDPR Articles 32 to 36).

## 9. Personal data breaches

Bridge notifies the Customer without undue delay, and in any case within 48 hours, after becoming aware of a personal data breach affecting the Customer's personal data. The notice includes, as far as available, the nature of the breach, the categories and approximate number of people and records concerned, likely consequences, and the measures taken or proposed. Bridge provides further information as it becomes available.

## 10. Deletion or return at the end

At the end of the services, and at the Customer's choice, Bridge deletes or returns the personal data, and deletes existing copies, unless EU or Member State law requires storage. Daily backups are not altered individually; they expire on their own within 30 days.

The Customer's design system is not held by Bridge: it stays in the Customer's GitHub repository. Short-lived copies of reads expire within 7 days.

## 11. Audits

Bridge makes available to the Customer the information necessary to demonstrate compliance with this DPA. Bridge's source code is public under the MIT license, and the security page links each statement to the code that does it. Bridge allows and contributes to audits, including inspections, by the Customer or an auditor it mandates, with at least 30 days' notice, during business hours, at the Customer's cost, no more than once a year except after a personal data breach or at the request of a supervisory authority.

Bridge holds no certification at the date of this template (no SOC 2, no ISO 27001, no penetration test report).

## 12. International transfers

12.1 Bridge's database (Upstash) and functions (Vercel) run in Frankfurt, Germany, and the daily backup (Vercel Blob) is kept in Paris, France. Static pages are served from Vercel's global network.

12.2 Vercel Inc., Upstash Inc. and Resend Inc. are companies based in the United States. Resend's sending region is not chosen by Bridge. Where personal data is transferred, or made accessible, outside the European Economic Area, the transfer relies on the EU-US Data Privacy Framework certification of the subprocessor where it applies, and otherwise the Standard Contractual Clauses adopted by Commission Implementing Decision (EU) 2021/914, module three (processor to processor), incorporated by reference, together with the subprocessors' own data processing terms.

## 13. Liability and order of precedence

Liability under this DPA is governed by [the liability provisions of the Agreement]. If this DPA and the Agreement conflict on data protection, this DPA prevails.

## 14. Governing law

This DPA is governed by French law, and the courts of Montpellier, France, have jurisdiction.

---

## Annex 1. Description of the processing

| | |
|---|---|
| Data subjects | Section 2 |
| Categories of data | Section 3 |
| Nature and purpose | Section 1 |
| Duration and retention | Section 1.2 and "What Bridge stores" on the security page |
| Customer contact for data protection | [name, email] |
| Bridge contact for data protection | Florian Gouloubi, founder, [email] |

## Annex 2. Technical and organisational measures

As described on the security page, at the date of this template:

- **Data minimisation.** Bridge keeps records about people and teams, not the Customer's design system. Copies of repository reads expire within 7 days at most.
- **No passwords.** Sign-in with GitHub or a one-time email code (10 minutes, 5 tries, only its SHA-256 stored).
- **Sessions.** Cookie signed with HMAC-SHA256, HttpOnly, Secure, SameSite=Lax, 30 days. "Sign out everywhere" ends every session.
- **Encryption of kept GitHub tokens.** AES-256-GCM under a key derived with HKDF-SHA256 for that purpose only.
- **Tokens Bridge issues** (AI connector, sign-in links, invite links): only their SHA-256 is stored.
- **Access control by GitHub.** Each person acts with their own GitHub permissions; GitHub Apps are installed on selected repositories only; the server's installation tokens are minted per request, limited to one repository, and never stored.
- **No AI keys on Bridge's servers.** The AI connector sees tool calls, not conversations, and cannot merge.
- **Network.** Strict Content-Security-Policy, Cache-Control: no-store on every function, Origin checks on calls that change data, OAuth 2.1 with PKCE (S256) for the connector, the Figma plugin limited by Figma to two domains.
- **Logging.** No analytics or tracking script. Bridge's functions log nothing about people; the hosting platform keeps its own request logs.
- **Backups.** Daily, to a private Vercel Blob store, 30 kept. Sign-in codes and AI connector tokens are left out.
- **Deletion.** A person can delete their account at once; it ends their sessions and AI connections. Unused AI connections end after 90 days.
- **Transparency.** Public source code (MIT) and automated tests that check the security page against the code.
- **Reporting.** Security problems are reported privately through GitHub's security advisory form for the repository.

Known limits, stated on the security page: no certification or outside audit, no single sign-on, no encryption with customer keys, one server secret from which several purpose-specific keys are derived, no audit log of Bridge's own actions beyond GitHub's history.

## Annex 3. Subprocessors

| Company | Service | Location of the data | Data |
|---|---|---|---|
| Vercel Inc. (United States) | Hosting, functions, daily backup (Vercel Blob) | Functions: Frankfurt, Germany. Backup: Paris, France. Static pages: global network | All records pass through the functions; backup holds accounts, members, invites and team records |
| Upstash Inc. (United States) | Redis database | Frankfurt, Germany | The records in section 3 |
| Resend Inc. (United States) | Sign-in and invitation emails | Not chosen by Bridge | Recipient email address and email text |

Not subprocessors of Bridge: GitHub (the Customer's own provider, under the Customer's agreement with GitHub) and the Customer's AI provider (the Customer's own account).

---

Signed for the Customer: [name, title, date]

Signed for Bridge: Florian Gouloubi, founder, [date]
