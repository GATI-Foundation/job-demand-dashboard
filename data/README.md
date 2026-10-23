# data/ — clean sector CSVs

Put one clean CSV per sector here. The dashboard for a sector loads the file
named in `assets/js/sectors.js`.

Expected filenames (default config):

| Sector        | File                  |
| ------------- | --------------------- |
| Healthcare    | `healthcare.csv`      |
| Hospitality   | `hospitality.csv`     |
| Construction  | `construction.csv`    |
| Logistics     | `logistics.csv`       |

`healthcare.csv` currently contains a small **sample** so the dashboard runs out
of the box. Replace it with your real clean CSV (same columns) and add the other
three.

Columns used (from the final classifier output):
`Job_Title, Job_Category, ISCO_4, ISCO_3, ISCO_2, ISCO_4_name, State,
Company_Name, Employer_Category, Date_Posted, Employment_type, Salary,
Description, Requirements, Benefits, Work_Type, Job_URL, Job_ID, Scope_Category`

Rows whose `Scope_Category` (or `Job_Category`) is `Out of Scope` /
`CLASSIFICATION_FAILED`, or that have no `ISCO_4`, are dropped from the analysis.
