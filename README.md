# geo-stats

Small service to record data associated with rough city locations for statistical purposes.

## Installation

* Clone the repository then execute : `yarn install`
* Download a MMDB database, such as the one at https://db-ip.com/db/download/ip-to-city-lite
* Create a private key in the PKCS#8 format
* Copy the file `.env.example` to `.env` and fill in the values
* Execute the `schema.sql` file in your database to create the table.

## Usage

```bash
yarn start
```

## Sending data to be recorded

First, make sure the platform is added to the `platforms` table in the database, along with its key in SPKI (PEM) format.

Send a POST request to the `/save` endpoint with the following data :

```json
{
    "platform_id": [platform id in the database],
    "token": [JWES-encoded token of the following object] {
        "ip": [IP address of the user],
        "user": [string temporarily identifying the user for the session],
        "data": [any data you want to record]
    }
}
```

## Privacy considerations

IP addresses are never recorded in the database ; they are only temporarily kept in memory in a LRU cache to avoid database lookups.

Location information is only saved once per city ; if multiple IPs from the same city are mapped to more precise locations, only one location will actually be saved, avoiding identifying each user individually.

The user string sent by platforms is meant to be a temporary string, such as a session ID, which temporarily identifies an user for a session but doesn't allow to track that user across multiple sessions.

This tool is meant to be used with a reduced accuracy database such as the one linked above.