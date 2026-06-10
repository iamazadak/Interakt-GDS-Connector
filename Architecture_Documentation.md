# Interakt to Google Sheets Connector — Architecture & Flow

This document provides a comprehensive overview of the system architecture, components, and workflows of the Interakt CRM to Google Sheets Connector.

## 1. System Overview

The solution is a modular Google Apps Script (GAS) application designed to extract customer data from the Interakt CRM API and synchronize it with a Google Spreadsheet. This spreadsheet then acts as the central data source for a Looker Studio Dashboard, providing near real-time insights into CRM leads.

### System Diagram

```plantuml
@startuml
left to right direction

package "Interakt CRM" {
    [Interakt API] as API
}

package "Google Apps Script" {
    [Trigger Manager] as Trigger
    [Sync Jobs] as Sync
    [Interakt Client] as Client
    [Field Mapper] as Mapper
    [Sheet Manager] as SheetMgr
    [Logger] as Log
    
    Trigger --> Sync : Schedules
    Sync --> Client : Fetches Data
    Client --> Sync : Returns API Data
    Sync --> Mapper : Transforms Data
    Mapper --> Sync : Returns Mapped Rows
    Sync --> SheetMgr : Upserts Rows
    Sync --> Log : Logs Run
}

package "Google Sheets" {
    [Config] as ConfigSheet
    [Leads] as LeadsSheet
    [Sync_Log] as LogSheet
    [Agents] as AgentsSheet
    
    SheetMgr <--> ConfigSheet : Reads/Writes
    SheetMgr --> LeadsSheet : Upserts Data
    SheetMgr --> AgentsSheet : Seeds
    Log --> LogSheet : Appends
}

package "Looker Studio" {
    [Looker Dashboard] as Dashboard
    Dashboard --> LeadsSheet : Reads Data
}

API <--> Client : REST Requests
@enduml
```

## 2. Synchronization Workflows

The application operates via two primary synchronization workflows managed by time-driven triggers: **Full Sync** and **Incremental Sync**.

### 2.1 Incremental Sync Sequence

The Incremental Sync runs hourly to fetch and upsert only the customers whose profiles have been modified since the last successful sync. This minimizes API load and ensures fast updates.

```plantuml
@startuml
participant "TriggerManager" as TM
participant "IncrementalSync" as IS
participant "SheetManager" as SM
participant "InteraktClient" as IC
participant "FieldMapper" as FM
participant "Logger" as L

TM -> IS: runIncrementalSync() (Hourly)
IS -> L: beginRun('INCREMENTAL_SYNC')
IS -> SM: initialiseSheets()
IS -> SM: getConfigValue(LAST_INCREMENTAL_SYNC)
SM --> IS: sinceIso timestamp
IS -> IC: fetchModifiedSince(sinceIso)
IC --> IS: Return modified customers

alt If no changes
    IS -> SM: setConfigValue(LAST_INCREMENTAL_SYNC, now)
    IS -> L: endRun('NO_CHANGES')
else Changes found
    loop For each user
        IS -> FM: userToRow(user)
        FM --> IS: Return mapped row
    end
    IS -> SM: upsertRows(rows)
    SM --> IS: Return result (added, updated, skipped)
    IS -> SM: setConfigValue(LAST_INCREMENTAL_SYNC, now)
    IS -> L: endRun('SUCCESS')
end
@enduml
```

### 2.2 Full Sync Sequence

The Full Sync acts as a weekly reconciliation pass. It pulls the entire customer database from Interakt and updates the Google Sheet to ensure absolute consistency and capture any edge-case modifications.

```plantuml
@startuml
participant "TriggerManager" as TM
participant "FullSync" as FS
participant "SheetManager" as SM
participant "InteraktClient" as IC
participant "FieldMapper" as FM
participant "Logger" as L

TM -> FS: runFullSync() (Weekly)
FS -> L: beginRun('FULL_SYNC')
FS -> SM: initialiseSheets()
FS -> IC: fetchAllUsers()
IC --> FS: Return all customers (paginated)

loop For each user
    FS -> FM: userToRow(user)
    FM --> FS: Return mapped row
end

FS -> SM: upsertRows(rows)
SM --> FS: Return result (added, updated, skipped)
FS -> SM: setConfigValue(LAST_FULL_SYNC, now)
FS -> SM: setConfigValue(LAST_INCREMENTAL_SYNC, now)
FS -> L: endRun('SUCCESS')
@enduml
```

## 3. Data Transformation & Upsert Flow

Data arriving from the Interakt API is highly nested and requires cleaning and normalization before it can be written to the flat structure of a Google Sheet.

The `FieldMapper` module handles deep property extraction, resolves system UUIDs to human-readable names (for stage and owner), and normalizes data types. The `SheetManager` handles intelligent upserts using a row hashing mechanism to detect modifications and prevent redundant writes.

```plantuml
@startuml
top to bottom direction
skinparam defaultTextAlignment center

rectangle "Raw API Customer Object" as RawData

package "Field Mapper Processing" {
    rectangle "Extract Standard Fields" as StdFields
    rectangle "Extract Trait Fields" as TraitFields
    
    rectangle "Derived Field Processing" as IsDerived
    rectangle "Decode Status via STAGE_MAP" as DecodeStatus
    rectangle "Decode Owner via AGENT_MAP" as DecodeOwner
    rectangle "Normalise Data Type\n(number, boolean, etc.)" as Normalise

    rectangle "Compute Row Hash" as ComputeHash
    rectangle "Add Current Timestamp" as AddTimestamp
    
    rectangle "Combined Row Data" as CombinedData
}

package "Sheet Manager Upsert" {
    rectangle "Match by Unique Key" as MatchKey
    rectangle "Check if Row Exists" as RowExists
    rectangle "Check if Hash Changed" as HashChanged
    
    rectangle "Update Specific Cells" as UpdateRow
    rectangle "Skip Row" as SkipRow
    rectangle "Append New Row" as AppendRow
}

RawData --> StdFields
RawData --> TraitFields
RawData --> ComputeHash
RawData --> AddTimestamp

TraitFields --> IsDerived
IsDerived --> DecodeStatus : [Field is Status]
IsDerived --> DecodeOwner : [Field is Owner]
IsDerived --> Normalise : [Standard Trait]

StdFields --> CombinedData
DecodeStatus --> CombinedData
DecodeOwner --> CombinedData
Normalise --> CombinedData
ComputeHash --> CombinedData
AddTimestamp --> CombinedData

CombinedData --> MatchKey
MatchKey --> RowExists
RowExists --> HashChanged : [Exists]
RowExists --> AppendRow : [Does Not Exist]

HashChanged --> UpdateRow : [Hash Changed]
HashChanged --> SkipRow : [Hash Unchanged]

@enduml
```

## 4. Components & Modules

- **Config.gs**: The central configuration registry. Holds API keys, Sheet IDs, Field Maps, mappings for statuses and agents (UUIDs), and Trigger schedules.
- **InteraktClient.gs**: The HTTP interface to the Interakt API. Manages authentication, paginated API requests, and implements exponential back-off for rate limits and intermittent failures.
- **FieldMapper.gs**: The data transformation layer. Extracts fields based on `CONFIG`, resolves internal UUIDs, normalizes values to ensure Looker Studio compatibility, and generates a data hash for each record to support intelligent upserts.
- **SheetManager.gs**: The database interaction layer. Initializes required Sheet tabs, reads and updates the `Config` sheet, applies Tier-based color styling to columns, and handles the batch upsert logic to ensure optimal performance against Google Apps Script quotas.
- **Logger.gs**: The logging utility. Generates structured logs for the script's execution, writing them to both the Stackdriver console and the `Sync_Log` sheet for easy operational oversight.
- **TestRunner.gs**: A built-in test suite for validating field mappings and sheet configurations prior to deployment.
- **TriggerManager.gs**: Automates the creation and destruction of the time-driven triggers required to run the Sync jobs.
