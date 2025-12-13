<?php

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', '0');

// JSON на любые необработанные исключения
set_exception_handler(function (Throwable $e) {
    http_response_code(502);
    echo json_encode(['error' => 'exception', 'message' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
});

// JSON на фаталы/таймауты (вместо HTML)
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && (stripos($e['message'] ?? '', 'Maximum execution time') !== false || $e['type'] === E_ERROR)) {
        http_response_code(504);
        echo json_encode(['error' => 'timeout', 'message' => 'Upstream took too long'], JSON_UNESCAPED_UNICODE);
    }
});


if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    http_response_code(200);
    exit();
}

$service = new service('lBYFH953RqTyIub4ZsrMjVBZbcWgoJrE', '5K4vYnHlnxwEnqO1yOgeY52PG0mTQkjA','https://api.cdek.ru/v2');

$service->process($_GET, file_get_contents('php://input'));

class service
{
    /**
     * @var string Auth login
     */
    private $login;
    /**
     * @var string Auth pwd
     */
    private $secret;
    /**
     * @var string Base Url for API 2.0 Production
     */
    private $baseUrl;
    /**
     * @var string Auth Token
     */
    private $authToken;
    /**
     * @var array Data From Request
     */
    private $requestData;
    /** @var array Request metrics */
    private $metrics;

    public function __construct($login, $secret, $baseUrl = 'https://api.cdek.ru/v2')
    {
        $this->login = $login;
        $this->secret = $secret;
        $this->baseUrl = $baseUrl;
        $this->metrics = array();
    }

    public function process($requestData, $body)
    {
        $time = $this->startMetrics();
        $this->requestData = array_merge($requestData, json_decode($body, true) ?: array());

        if (!isset($this->requestData['action'])) {
            $this->sendValidationError('Action is required');
        }

        try {
            $this->getAuthToken();

            switch ($this->requestData['action']) {
                case 'offices':
                    $this->sendResponse($this->getOffices(), $time);
                    break;
                case 'calculate':
                    $this->sendResponse($this->calculate(), $time);
                    break;
                case 'create_order':
                case 'register_order':
                    $this->sendResponse($this->createOrder(), $time);
                    break;
                default:
                    $this->sendValidationError('Unknown action');
            }
        } catch (Throwable $e) {
            $this->http_response_code(502);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'service_failed', 'message' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
            exit();
        }
    }

    private function sendValidationError($message)
    {
        $this->http_response_code(400);
        header('Content-Type: application/json');
        header('X-Service-Version: 3.11.1');
        echo json_encode(array('message' => $message));
        exit();
    }

    private function http_response_code($code)
    {
        switch ($code) {
            case 100:
                $text = 'Continue';
                break;
            case 101:
                $text = 'Switching Protocols';
                break;
            case 200:
                $text = 'OK';
                break;
            case 201:
                $text = 'Created';
                break;
            case 202:
                $text = 'Accepted';
                break;
            case 203:
                $text = 'Non-Authoritative Information';
                break;
            case 204:
                $text = 'No Content';
                break;
            case 205:
                $text = 'Reset Content';
                break;
            case 206:
                $text = 'Partial Content';
                break;
            case 300:
                $text = 'Multiple Choices';
                break;
            case 301:
                $text = 'Moved Permanently';
                break;
            case 302:
                $text = 'Moved Temporarily';
                break;
            case 303:
                $text = 'See Other';
                break;
            case 304:
                $text = 'Not Modified';
                break;
            case 305:
                $text = 'Use Proxy';
                break;
            case 400:
                $text = 'Bad Request';
                break;
            case 401:
                $text = 'Unauthorized';
                break;
            case 402:
                $text = 'Payment Required';
                break;
            case 403:
                $text = 'Forbidden';
                break;
            case 404:
                $text = 'Not Found';
                break;
            case 405:
                $text = 'Method Not Allowed';
                break;
            case 406:
                $text = 'Not Acceptable';
                break;
            case 407:
                $text = 'Proxy Authentication Required';
                break;
            case 408:
                $text = 'Request Time-out';
                break;
            case 409:
                $text = 'Conflict';
                break;
            case 410:
                $text = 'Gone';
                break;
            case 411:
                $text = 'Length Required';
                break;
            case 412:
                $text = 'Precondition Failed';
                break;
            case 413:
                $text = 'Request Entity Too Large';
                break;
            case 414:
                $text = 'Request-URI Too Large';
                break;
            case 415:
                $text = 'Unsupported Media Type';
                break;
            case 500:
                $text = 'Internal Server Error';
                break;
            case 501:
                $text = 'Not Implemented';
                break;
            case 502:
                $text = 'Bad Gateway';
                break;
            case 503:
                $text = 'Service Unavailable';
                break;
            case 504:
                $text = 'Gateway Time-out';
                break;
            case 505:
                $text = 'HTTP Version not supported';
                break;
            default:
                exit('Unknown http status code "' . htmlentities($code) . '"');
        }

        $protocol = (isset($_SERVER['SERVER_PROTOCOL']) ? $_SERVER['SERVER_PROTOCOL'] : 'HTTP/1.0');
        header($protocol . ' ' . $code . ' ' . $text);
        $GLOBALS['http_response_code'] = $code;
    }

    private function getAuthToken()
    {
        $time = $this->startMetrics();

        $token = $this->httpRequest('oauth/token', array(
            'grant_type' => 'client_credentials',
            'client_id' => $this->login,
            'client_secret' => $this->secret,
        ), true);

        $this->endMetrics('auth', 'Server Auth Time', $time);

        $result = json_decode($token['result'], true);

        if (!isset($result['access_token'])) {
            throw new RuntimeException('Server not authorized to CDEK API');
        }

        $this->authToken = $result['access_token'];
    }

    private function startMetrics()
    {
        return function_exists('hrtime') ? hrtime(true) : microtime(true);
    }

    private function httpRequest($method, $data, $useFormData = false, $useJson = false)
    {
        $ch = curl_init("$this->baseUrl/$method");

        $headers = array(
            'Accept: application/json',
            'X-App-Name: widget_pvz',
            'X-App-Version: 3.11.1'
        );
        if ($this->authToken) {
            $headers[] = "Authorization: Bearer $this->authToken";
        }

        if ($useFormData) {
            curl_setopt_array($ch, array(
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $data,
            ));
        } elseif ($useJson) {
            $headers[] = 'Content-Type: application/json';
            curl_setopt_array($ch, array(
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode($data, JSON_UNESCAPED_UNICODE),
            ));
        } else {
            curl_setopt($ch, CURLOPT_URL, "$this->baseUrl/$method?" . http_build_query($data));
        }

        curl_setopt_array($ch, array(
            CURLOPT_USERAGENT      => 'widget/3.11.1',
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER         => true,

            // 🔴 ключевые параметры
            CURLOPT_CONNECTTIMEOUT => 5,   // ждать коннект не дольше 5с
            CURLOPT_TIMEOUT        => 12,  // общий таймаут запроса < 30с php
            CURLOPT_IPRESOLVE      => CURL_IPRESOLVE_V4, // обойти глюки с IPv6/DNS
            CURLOPT_ENCODING       => '',  // принимать gzip/deflate
            CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_1_1,
            CURLOPT_FAILONERROR    => false, // сами обработаем код
        ));

        $response   = curl_exec($ch);
        $errno      = curl_errno($ch);
        $err        = curl_error($ch);
        $status     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);

        if ($response === false || $errno) {
            throw new RuntimeException("curl($method) failed: $err", $errno ?: 500);
        }

        $headersStr = substr($response, 0, $headerSize);
        $result     = substr($response, $headerSize);

        // Если апстрим вернул не-JSON (например, HTML-страницу ошибки) — не пускаем это дальше
        $decoded = json_decode($result, true);
        if ($decoded === null) {
            throw new RuntimeException("Upstream returned non-JSON for $method (HTTP $status)");
        }

        // Пробрасываем полезную мета-инфу
        $addedHeaders = $this->getHeaderValue($headersStr);
        return array('result' => json_encode($decoded, JSON_UNESCAPED_UNICODE), 'addedHeaders' => $addedHeaders);
    }

    private function getHeaderValue($headers)
    {
        $headerLines = explode("\r\n", $headers);
        return array_filter($headerLines, static function ($line) {
            return !empty($line) && stripos($line, 'X-') !== false;
        });
    }

    private function endMetrics($metricName, $metricDescription, $start)
    {
        $this->metrics[] = array(
            'name' => $metricName,
            'description' => $metricDescription,
            'time' => round(function_exists('hrtime') ? (hrtime(true) - $start) / 1e+6 : (microtime(true) - $start) * 1000,
                2),
        );
    }

    private function sendResponse($data, $start)
    {
        $this->http_response_code(200);
        header('Content-Type: application/json');
        header('X-Service-Version: 3.11.1');
        if (!empty($data['addedHeaders'])) {
            foreach ($data['addedHeaders'] as $header) {
                header($header);
            }
        }

        $this->endMetrics('total', 'Total Time', $start);

        if (!empty($this->metrics)) {
            header('Server-Timing: ' . array_reduce($this->metrics, function ($c, $i) {
                    return $c . $i['name'] . ';desc="' . $i['description'] . '";dur=' . $i['time'] . ',';
                }, ''));
        }

        echo $data['result'];

        exit();
    }

    protected function getOffices()
    {
        $time = $this->startMetrics();

        // дефолты
        if (empty($this->requestData['type'])) $this->requestData['type'] = 'PVZ';
        if (empty($this->requestData['country_code'])) $this->requestData['country_code'] = 'RU';
        if (empty($this->requestData['lang'])) $this->requestData['lang'] = 'rus';
        if (!isset($this->requestData['page'])) $this->requestData['page'] = 0;
        if (empty($this->requestData['size'])) $this->requestData['size'] = 500;

        // filters flatten
        $filters = $this->requestData['filters'] ?? array();
        $filters = is_array($filters) ? $filters : array();

        foreach (array('city_code','city','region_code','postal_code','kladr_code','fias_guid','longitude','latitude') as $k) {
            if (isset($filters[$k]) && $filters[$k] !== '' && !isset($this->requestData[$k])) {
                $this->requestData[$k] = $filters[$k];
            }
        }

        // определяем: есть ли уже нормальный городской фильтр
        $hasCityFilter =
            $this->hasValue('city_code') ||
            $this->hasValue('postal_code') ||
            $this->hasValue('fias_guid') ||
            $this->hasValue('kladr_code') ||
            $this->hasValue('city') ||
            $this->hasValue('region_code');

        // если city-фильтра нет, но есть координаты — пытаемся превратить lat/lon в city_code / postal_code
        if (!$hasCityFilter && $this->hasValue('longitude') && $this->hasValue('latitude')) {
            $geoStart = $this->startMetrics();

            $lon = $this->toFloat($this->requestData['longitude']);
            $lat = $this->toFloat($this->requestData['latitude']);

            $geo = $this->reverseGeocodeYandex($lon, $lat); // ['postal_code' => '...', 'city' => '...']

            $this->endMetrics('geo', 'Reverse geocode (lat/lon -> address)', $geoStart);

            if (!empty($geo['postal_code']) || !empty($geo['city'])) {
                // подставим postal_code/city (полезно даже если city_code не нашли)
                if (!empty($geo['postal_code']) && !$this->hasValue('postal_code')) {
                    $this->requestData['postal_code'] = $geo['postal_code'];
                }
                if (!empty($geo['city']) && !$this->hasValue('city')) {
                    $this->requestData['city'] = $geo['city'];
                }

                $cityStart = $this->startMetrics();
                $cityCode = $this->resolveCdekCityCode(
                    $geo['postal_code'] ?? null,
                    $geo['city'] ?? null
                );
                $this->endMetrics('city', 'Resolve city_code via CDEK location/cities', $cityStart);

                if (!empty($cityCode)) {
                    $this->requestData['city_code'] = $cityCode;
                    $hasCityFilter = true;
                }
            }

            // ВАЖНО: deliverypoints не умеет фильтровать по координатам — убираем, чтобы не мешали
            unset($this->requestData['longitude'], $this->requestData['latitude']);
        }

        // если вообще ничего не помогло — падение в дефолтный город (Красноярск)
        if (!$hasCityFilter) {
            $defaultCityCode = 278;
            $defaultCityName = getenv('CDEK_DEFAULT_CITY') ?: 'Красноярск';
            if (empty($defaultCityCode)) $defaultCityCode = 278;

            $this->requestData['city_code'] = $defaultCityCode;
            $this->requestData['city']      = $defaultCityName;
        }

        $result = $this->httpRequest('deliverypoints', $this->requestData);
        $this->endMetrics('office', 'Offices Request', $time);
        return $result;
    }

    protected function calculate()
    {
        $time = $this->startMetrics();
        $result = $this->httpRequest('calculator/tarifflist', $this->requestData, false, true);

        $this->endMetrics('calc', 'Calculate Request', $time);
        return $result;
    }

    protected function createOrder()
    {
        $time = $this->startMetrics();
        $payload = $this->buildOrderPayload($this->requestData);

        if (empty($payload['number'])) {
            $this->sendValidationError('number is required');
        }
        if (empty($payload['tariff_code'])) {
            $this->sendValidationError('tariff_code is required');
        }
        if (empty($payload['recipient']['name']) || empty($payload['recipient']['phones'][0]['number'])) {
            $this->sendValidationError('recipient.name and recipient.phones[0].number are required');
        }
        if (empty($payload['to_location']) && empty($payload['delivery_point'])) {
            $this->sendValidationError('to_location or delivery_point is required');
        }
        if (empty($payload['packages']) || !is_array($payload['packages'])) {
            $this->sendValidationError('packages are required');
        }

        $result = $this->httpRequest('orders', $payload, false, true);
        $this->endMetrics('order', 'Order Create Request', $time);
        return $result;
    }
    
    private function hasValue($key): bool
    {
        return isset($this->requestData[$key]) && $this->requestData[$key] !== '' && $this->requestData[$key] !== null;
    }

    private function toFloat($v): float
    {
        if (is_string($v)) $v = str_replace(',', '.', $v);
        return (float)$v;
    }

    /**
     * Reverse geocode через Yandex Geocoder:
     * lat/lon -> ['postal_code' => '660000', 'city' => 'Красноярск']
     */
    private function reverseGeocodeYandex(float $lon, float $lat): array
    {
        $key = getenv('310f9193-b426-4cdd-8e65-b03ac33526fa');
        if (!$key) return array();

        // лёгкий кеш (если включён APCu)
        $cacheKey = 'yx_geo_' . md5(round($lon, 3) . ',' . round($lat, 3));
        if (function_exists('apcu_fetch')) {
            $cached = apcu_fetch($cacheKey);
            if (is_array($cached)) return $cached;
        }

        // kind=house обычно лучше отдаёт postal_code, чем locality
        $url = 'https://geocode-maps.yandex.ru/v1/?' . http_build_query(array(
            'apikey' => $key,
            'geocode' => $lon . ',' . $lat,
            'format' => 'json',
            'lang' => 'ru_RU',
            'results' => 1,
            'kind' => 'house',
        ));

        $data = $this->httpGetJson($url, 2, 4);
        $parsed = $this->parseYandexGeocoderResponse($data);

        // если вдруг не нашли город — пробуем locality
        if (empty($parsed['city'])) {
            $url2 = 'https://geocode-maps.yandex.ru/v1/?' . http_build_query(array(
                'apikey' => $key,
                'geocode' => $lon . ',' . $lat,
                'format' => 'json',
                'lang' => 'ru_RU',
                'results' => 1,
                'kind' => 'locality',
            ));
            $data2 = $this->httpGetJson($url2, 2, 4);
            $parsed2 = $this->parseYandexGeocoderResponse($data2);
            $parsed = array_merge($parsed, array_filter($parsed2));
        }

        if (function_exists('apcu_store')) {
            apcu_store($cacheKey, $parsed, 86400);
        }

        return $parsed;
    }

    private function parseYandexGeocoderResponse($data): array
    {
        if (!is_array($data)) return array();

        $fm = $data['response']['GeoObjectCollection']['featureMember'][0]['GeoObject'] ?? null;
        if (!$fm) return array();

        $addr = $fm['metaDataProperty']['GeocoderMetaData']['Address'] ?? array();
        $components = $addr['Components'] ?? array();

        $postal = $addr['postal_code'] ?? null;
        if (is_string($postal)) {
            $postal = preg_replace('/\D+/', '', $postal);
        }

        $city = null;
        foreach ($components as $c) {
            $kind = $c['kind'] ?? '';
            if ($kind === 'locality') {
                $city = $c['name'] ?? null;
                break;
            }
        }
        // иногда вместо locality приходит province/area — подстрахуемся
        if (!$city) {
            foreach ($components as $c) {
                $kind = $c['kind'] ?? '';
                if (in_array($kind, array('province', 'area', 'district'), true)) {
                    $city = $c['name'] ?? null;
                    break;
                }
            }
        }

        $out = array();
        if (!empty($postal)) $out['postal_code'] = $postal;
        if (!empty($city)) $out['city'] = $city;
        return $out;
    }

    private function httpGetJson(string $url, int $connectTimeoutSec = 2, int $timeoutSec = 4)
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER         => false,
            CURLOPT_CONNECTTIMEOUT => $connectTimeoutSec,
            CURLOPT_TIMEOUT        => $timeoutSec,
            CURLOPT_ENCODING       => '',
        ));
        $resp = curl_exec($ch);
        $errno = curl_errno($ch);
        $err = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($resp === false || $errno) {
            return null;
        }
        if ($status < 200 || $status >= 300) {
            return null;
        }
        $decoded = json_decode($resp, true);
        return is_array($decoded) ? $decoded : null;
    }

    /**
     * CDEK location/cities -> city_code
     * Параметры там как минимум: country_codes, postal_code, city, size, page, lang. :contentReference[oaicite:2]{index=2}
     */
    private function resolveCdekCityCode(?string $postalCode, ?string $city): ?int
    {
        $postalCode = $postalCode ? preg_replace('/\D+/', '', $postalCode) : null;
        $city = $city ? trim($city) : null;

        if (!$postalCode && !$city) return null;

        $cacheKey = 'cdek_city_' . md5(($postalCode ?: '') . '|' . ($city ?: ''));
        if (function_exists('apcu_fetch')) {
            $cached = apcu_fetch($cacheKey);
            if (is_int($cached)) return $cached;
        }

        $params = array(
            'country_codes' => 'RU',
            'lang' => 'rus',
            'size' => 5,
            'page' => 0,
        );
        if ($postalCode) $params['postal_code'] = $postalCode;
        if ($city) $params['city'] = $city;

        $resp = $this->httpRequest('location/cities', $params);
        $arr = json_decode($resp['result'] ?? 'null', true);

        if (!is_array($arr) || empty($arr)) return null;

        // выбираем самый “точный”: сперва по postal_code (если есть в массиве postal_codes), иначе первый
        $best = $arr[0];

        if ($postalCode) {
            foreach ($arr as $c) {
                $pcs = $c['postal_codes'] ?? array();
                if (is_array($pcs) && in_array($postalCode, $pcs, true) && !empty($c['code'])) {
                    $best = $c;
                    break;
                }
            }
        }

        $code = isset($best['code']) ? (int)$best['code'] : null;

        if ($code && function_exists('apcu_store')) {
            apcu_store($cacheKey, $code, 86400);
        }

        return $code ?: null;
    }


    private function buildOrderPayload($data)
    {
        // Если прилетел уже готовый payload — используем его как есть
        if (!empty($data['tariff_code']) && isset($data['recipient']) && (isset($data['to_location']) || isset($data['delivery_point']))) {
            $payload = $data;
            unset($payload['action']);
            if (!isset($payload['type'])) {
                $payload['type'] = 1;
            }
            return $payload;
        }

        // Иначе собираем из полей виджета
        $payload = array();
        $payload['type'] = 1;

        $payload['number'] = $data['number']
            ?? $data['orderNumber']
            ?? $data['orderId']
            ?? $data['id']
            ?? ('order-' . time());

        $tariff = $data['cdekTariffCode'] ?? null;
        if (!$tariff && !empty($data['cdekTariff']) && is_array($data['cdekTariff'])) {
            $tariff = $data['cdekTariff']['tariff_code'] ?? ($data['cdekTariff']['code'] ?? null);
        }
        $payload['tariff_code'] = $tariff;

        $payload['from_location'] = $this->buildFromLocation($data['cdekFrom'] ?? array());

        $mode = $data['cdekMode'] ?? 'office';
        $address = $this->decodeJsonIfNeeded($data['cdekAddress'] ?? array());

        if ($mode === 'office') {
            if (!empty($address['code'])) {
                $payload['delivery_point'] = $address['code'];
            }
        } else {
            $payload['to_location'] = $this->buildToLocationFromAddress($address);
        }

        $recipientFull = $data['recipientFullName'] ?? '';
        $payload['recipient'] = array(
            'name' => $this->buildRecipientName($recipientFull, $data),
            'phones' => array(array('number' => $this->normalizePhone($data['recipientPhoneDigits'] ?? ($data['phone'] ?? '')))),
        );

        $payload['packages'] = $this->buildPackages($this->decodeJsonIfNeeded($data['cdekGoods'] ?? array()), $data);

        if (!empty($data['cdekAddressLabel'])) {
            $payload['comment'] = $data['cdekAddressLabel'];
        } elseif (!empty($data['comment'])) {
            $payload['comment'] = $data['comment'];
        }

        // Оплата онлайн на сайте → в СДЭК стоимость доставки ставим 0 для получателя
        if (!empty($data['deliveryPayment']['payer']) && $data['deliveryPayment']['payer'] === 'sender') {
            $payload['delivery_recipient_cost'] = array('value' => 0);
            $payload['recipient_currency'] = 'RUB';
        }

        unset($payload['action']);
        return $payload;
    }

    private function decodeJsonIfNeeded($value)
    {
        if (is_array($value)) {
            return $value;
        }
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            return $decoded ?: array();
        }
        return array();
    }

    private function buildRecipientName($fullName, $data)
    {
        $fullName = trim((string)$fullName);
        if ($fullName !== '') {
            return $fullName;
        }

        $parts = array_filter(array(
            $data['lastName'] ?? null,
            $data['firstName'] ?? null,
            $data['middleName'] ?? null,
        ));
        return implode(' ', $parts);
    }

    private function normalizePhone($phone)
    {
        $digits = preg_replace('/\D+/', '', (string)$phone);
        if ($digits === '') {
            return '';
        }
        if ($digits[0] !== '7' && $digits[0] !== '8') {
            return '+' . $digits;
        }
        if ($digits[0] === '8') {
            $digits = '7' . substr($digits, 1);
        }
        return '+' . $digits;
    }

    private function buildFromLocation($from)
    {
        $from = $this->decodeJsonIfNeeded($from);
        return array_filter(array(
            'country_code' => $from['country_code'] ?? null,
            'code' => $from['city_code'] ?? null,
            'postal_code' => $from['postal_code'] ?? null,
            'address' => $from['address'] ?? null,
        ), static function ($v) {
            return $v !== null && $v !== '';
        });
    }

    private function buildToLocationFromAddress($address)
    {
        $address = $this->decodeJsonIfNeeded($address);
        return array_filter(array(
            'country_code' => $address['country_code'] ?? null,
            'code' => $address['city_code'] ?? ($address['location']['city_code'] ?? null),
            'postal_code' => $address['postal_code'] ?? ($address['location']['postal_code'] ?? null),
            'address' => $address['formatted'] ?? ($address['address'] ?? null),
        ), static function ($v) {
            return $v !== null && $v !== '';
        });
    }


    private function buildPackages($goods, $data)
    {
        $goods = is_array($goods) ? $goods : array();
        if (empty($goods)) {
            return array();
        }

        $packages = array();
        $totalPrice = isset($data['totalPrice']) ? (float)$data['totalPrice'] : 0;
        $count = count($goods);
        $baseCost = $count > 0 ? floor($totalPrice / $count) : 0;
        $remainder = $count > 0 ? $totalPrice - ($baseCost * $count) : 0;

        foreach ($goods as $idx => $g) {
            $weight = isset($g['weight_grams']) ? (int)$g['weight_grams'] : null;
            if ($weight === null && isset($g['weight'])) {
                $weight = (int)round(((float)$g['weight']) * 1000); // kg → grams
            }
            if ($weight === null || $weight <= 0) {
                $weight = 100; // минимальный вес 100г, чтобы не завалить валидацию
            }

            $length = isset($g['length']) ? (int)$g['length'] : null;
            $width  = isset($g['width']) ? (int)$g['width'] : null;
            $height = isset($g['height']) ? (int)$g['height'] : null;

            $cost = $baseCost + ($idx === 0 ? $remainder : 0);

            $packages[] = array_filter(array(
                'number' => 'pkg-' . ($idx + 1),
                'weight' => $weight,
                'length' => $length,
                'width' => $width,
                'height' => $height,
                'items' => array(array(
                    'name' => $g['name'] ?? ('Item ' . ($idx + 1)),
                    'ware_key' => $g['ware_key'] ?? ('SKU-' . ($idx + 1)),
                    'cost' => $cost,
                    'payment' => array('value' => 0),
                    'weight' => $weight,
                    'amount' => 1,
                )),
            ), static function ($v) {
                return $v !== null && $v !== '';
            });
        }

        return $packages;
    }
}
