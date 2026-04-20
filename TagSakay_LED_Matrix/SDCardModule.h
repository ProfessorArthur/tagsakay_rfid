#ifndef SD_CARD_MODULE_H
#define SD_CARD_MODULE_H

#include <Arduino.h>
#include <FS.h>
#include <SD.h>
#include <SPI.h>
#include "Config.h"

class SDCardModule {
public:
    SDCardModule();
    bool initialize();
    bool isReady();
    
    // File operations
    String readFile(const char* path);
    bool writeFile(const char* path, const char* message);
    bool appendFile(const char* path, const char* message);
    bool deleteFile(const char* path);
    bool exists(const char* path);
    
    // Database operations
    bool lookupTagRecord(const String& tagId, String& unitNumber, String& userName);
    String lookupUnitByTag(const String& tagId);
    String lookupUserByTag(const String& tagId);
    bool saveTag(const String& tagId, const String& unitNumber, const String& userName = "");
    
    // Info
    uint64_t getCardSize();

private:
    bool _initialized;
    SPIClass* _spi;
};

extern SDCardModule sdCard;

#endif // SD_CARD_MODULE_H
