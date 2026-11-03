// IANA time zones for common airports, used to place text-parsed flights at the right local time.
// Flights read from schema.org data usually carry their own UTC offset and don't need this.
const ZONES = {
  'Asia/Kolkata': 'DEL BOM BLR MAA HYD CCU COK AMD PNQ GOI GOX TRV IXC JAI LKO PAT GAU BBI IXB SXR VNS IDR NAG CJB IXM IXE TRZ VTZ RPR IXR BDQ ATQ DED IXJ UDR JDH IXA IXZ VGA TIR CCJ IXL HBX STV RAJ BHO GWL DIB JRH IMF AJL IXS AGR NMI HSR',
  'Asia/Dubai': 'DXB AUH SHJ DWC RKT',
  'Asia/Qatar': 'DOH', 'Asia/Bahrain': 'BAH', 'Asia/Muscat': 'MCT', 'Asia/Kuwait': 'KWI',
  'Asia/Riyadh': 'RUH JED DMM MED',
  'Asia/Singapore': 'SIN', 'Asia/Kuala_Lumpur': 'KUL PEN', 'Asia/Bangkok': 'BKK DMK HKT CNX',
  'Asia/Ho_Chi_Minh': 'SGN HAN DAD', 'Asia/Jakarta': 'CGK', 'Asia/Makassar': 'DPS', 'Asia/Manila': 'MNL',
  'Asia/Hong_Kong': 'HKG', 'Asia/Shanghai': 'PEK PKX PVG SHA CAN SZX CTU', 'Asia/Taipei': 'TPE',
  'Asia/Seoul': 'ICN GMP', 'Asia/Tokyo': 'NRT HND KIX', 'Asia/Kathmandu': 'KTM', 'Asia/Colombo': 'CMB',
  'Asia/Dhaka': 'DAC', 'Indian/Maldives': 'MLE', 'Asia/Karachi': 'KHI LHE ISB', 'Asia/Thimphu': 'PBH',
  'Europe/London': 'LHR LGW STN LTN MAN EDI BHX LCY GLA', 'Europe/Dublin': 'DUB',
  'Europe/Paris': 'CDG ORY NCE', 'Europe/Amsterdam': 'AMS', 'Europe/Berlin': 'FRA MUC BER DUS HAM',
  'Europe/Zurich': 'ZRH GVA', 'Europe/Vienna': 'VIE', 'Europe/Rome': 'FCO MXP', 'Europe/Madrid': 'MAD BCN',
  'Europe/Lisbon': 'LIS', 'Europe/Brussels': 'BRU', 'Europe/Copenhagen': 'CPH', 'Europe/Stockholm': 'ARN',
  'Europe/Oslo': 'OSL', 'Europe/Helsinki': 'HEL', 'Europe/Istanbul': 'IST SAW', 'Europe/Athens': 'ATH',
  'Europe/Prague': 'PRG', 'Europe/Warsaw': 'WAW', 'Europe/Moscow': 'SVO DME',
  'Africa/Cairo': 'CAI', 'Africa/Johannesburg': 'JNB CPT', 'Africa/Nairobi': 'NBO',
  'Africa/Addis_Ababa': 'ADD', 'Africa/Lagos': 'LOS',
  'America/New_York': 'JFK EWR LGA BOS IAD DCA ATL MIA MCO PHL CLT DTW FLL',
  'America/Toronto': 'YYZ YUL YOW', 'America/Chicago': 'ORD DFW IAH MSP AUS MDW',
  'America/Denver': 'DEN SLC', 'America/Phoenix': 'PHX',
  'America/Los_Angeles': 'LAX SFO SEA SAN SJC LAS PDX OAK', 'America/Vancouver': 'YVR',
  'America/Mexico_City': 'MEX', 'America/Sao_Paulo': 'GRU', 'America/Bogota': 'BOG',
  'America/Argentina/Buenos_Aires': 'EZE', 'Pacific/Honolulu': 'HNL',
  'Australia/Sydney': 'SYD', 'Australia/Melbourne': 'MEL', 'Australia/Brisbane': 'BNE',
  'Australia/Perth': 'PER', 'Pacific/Auckland': 'AKL',
};

export const AIRPORT_TZ = {};
for (const [tz, codes] of Object.entries(ZONES)) codes.split(' ').forEach((c) => { AIRPORT_TZ[c] = tz; });
