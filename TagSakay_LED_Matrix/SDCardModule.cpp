#include "SDCardModule.h"

SDCardModule sdCard;

SDCardModule::SDCardModule() : _initialized(false), _spi(nullptr) {}

bool SDCardModule::initialize() {
    if (_initialized) return true;

    Serial.println("[SD] Initializing SD card...");
    Serial.print("[SD] Pins: SCK="); Serial.print(SD_SCK_PIN);
    Serial.print(", MISO="); Serial.print(SD_MISO_PIN);
    Serial.print(", MOSI="); Serial.print(SD_MOSI_PIN);
    Serial.print(", CS="); Serial.println(SD_CS_PIN);

    // Initialize SPI with defined pins
    _spi = new SPIClass(VSPI);
    _spi->begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);

    // Initialize SD card
    if (!SD.begin(SD_CS_PIN, *_spi)) {
        Serial.println("[SD] Card Mount Failed");
        return false;
    }

    uint8_t cardType = SD.cardType();
    if (cardType == CARD_NONE) {
        Serial.println("[SD] No SD card attached");
        return false;
    }

    Serial.print("[SD] SD Card Type: ");
    if (cardType == CARD_MMC) Serial.println("MMC");
    else if (cardType == CARD_SD) Serial.println("SDSC");
    else if (cardType == CARD_SDHC) Serial.println("SDHC");
    else Serial.println("UNKNOWN");

    uint64_t cardSize = SD.cardSize() / (1024 * 1024);
    Serial.printf("[SD] SD Card Size: %lluMB\n", cardSize);

    _initialized = true;
    return true;
}

bool SDCardModule::isReady() {
    return _initialized;
}

String SDCardModule::readFile(const char* path) {
    if (!_initialized) return "";

    File file = SD.open(path);
    if (!file) {
        Serial.println("[SD] Failed to open file for reading");
        return "";
    }

    String content = "";
    size_t fileSize = file.size();
    if (fileSize > 0) {
        content.reserve(fileSize + 1);
    }

    while (file.available()) {
        content += (char)file.read();
    }
    file.close();
    return content;
}

bool SDCardModule::writeFile(const char* path, const char* message) {
    if (!_initialized) return false;

    File file = SD.open(path, FILE_WRITE);
    if (!file) {
        Serial.println("[SD] Failed to open file for writing");
        return false;
    }

    if (file.print(message)) {
        file.close();
        return true;
    } else {
        file.close();
        return false;
    }
}

bool SDCardModule::appendFile(const char* path, const char* message) {
    if (!_initialized) return false;

    File file = SD.open(path, FILE_APPEND);
    if (!file) {
        Serial.println("[SD] Failed to open file for appending");
        return false;
    }

    if (file.print(message)) {
        file.close();
        return true;
    } else {
        file.close();
        return false;
    }
}

bool SDCardModule::deleteFile(const char* path) {
    if (!_initialized) return false;
    return SD.remove(path);
}

bool SDCardModule::exists(const char* path) {
    if (!_initialized) return false;
    return SD.exists(path);
}

uint64_t SDCardModule::getCardSize() {
    if (!_initialized) return 0;
    return SD.cardSize();
}

// Database Operations
// Format: TAG_ID,UNIT_NUMBER,USER_NAME (one per line)
// Example: E2806894,101,John Doe

bool SDCardModule::lookupTagRecord(const String& tagId, String& unitNumber, String& userName) {
    unitNumber = "";
    userName = "";

    if (!_initialized) return false;

    String normalizedTag = tagId;
    normalizedTag.trim();
    normalizedTag.toUpperCase();
    if (normalizedTag.length() == 0) return false;

    File file = SD.open("/database.txt");
    if (!file) return false;

    String buffer = "";
    auto parseLine = [&](const String& line) -> bool {
        if (line.length() == 0) {
            return false;
        }

        int firstComma = line.indexOf(',');
        if (firstComma == -1) {
            return false;
        }

        int secondComma = line.indexOf(',', firstComma + 1);

        String dbTag = line.substring(0, firstComma);
        dbTag.trim();
        dbTag.toUpperCase();

        if (dbTag != normalizedTag) {
            return false;
        }

        if (secondComma == -1) {
            unitNumber = line.substring(firstComma + 1);
            unitNumber.trim();
            userName = "";
        } else {
            unitNumber = line.substring(firstComma + 1, secondComma);
            userName = line.substring(secondComma + 1);
            unitNumber.trim();
            userName.trim();
        }

        return true;
    };

    while (file.available()) {
        char c = file.read();
        if (c == '\r') {
            continue;
        }

        if (c == '\n') {
            buffer.trim();
            if (parseLine(buffer)) {
                file.close();
                return true;
            }
            buffer = "";
            continue;
        }

        buffer += c;
    }

    // Handle last line without trailing newline
    buffer.trim();
    bool found = parseLine(buffer);
    file.close();
    return found;
}

String SDCardModule::lookupUnitByTag(const String& tagId) {
    String unitNumber;
    String userName;
    if (lookupTagRecord(tagId, unitNumber, userName)) {
        return unitNumber;
    }
    return "";
}

String SDCardModule::lookupUserByTag(const String& tagId) {
    String unitNumber;
    String userName;
    if (lookupTagRecord(tagId, unitNumber, userName)) {
        return userName;
    }
    return "";
}

bool SDCardModule::saveTag(const String& tagId, const String& unitNumber, const String& userName) {
    if (!_initialized) return false;
    
    // Check if already exists to avoid duplicates (simple check)
    // For a large DB, this is inefficient, but fine for < 100 tags
    String existing = lookupUnitByTag(tagId);
    if (existing.length() > 0) {
        // Already exists - we might want to update it, but for now just skip
        // To update, we'd need to rewrite the file.
        return true; 
    }
    
    String line = tagId + "," + unitNumber + "," + userName + "\n";
    return appendFile("/database.txt", line.c_str());
}
